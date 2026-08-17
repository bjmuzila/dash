
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME } from "../lib/theme";
import { ThemedSelect } from "../components/ThemedSelect";
import { ThemedMonthPicker } from "../components/ThemedMonthPicker";
import RealMonth from "./budget/RealMonth";
import { CategoryBudgetSection } from "./budget/CategoryBudget";

type Bank = "coastal" | "truist" | "secu";
type BudgetProfile = { id: number; name: string; currency: string };
type RegisterRow = {
  id: number;
  entry_date: string;
  sort_order: number;
  label: string;
  bank: Bank;
  amount: number;
  is_beginning: number;
  recurring_tag?: string | null;
  category_id?: number | null;
};
type Category = { id: number; name: string; amount: number; color?: string | null };
type DailyBalance = { day: string; coastal: number; truist: number; secu: number };
type AmazonRow = { id: number; work_date: string; pay: number; gas: number };
type PropSource = "prop" | "cbedge" | "contracts";
// Per-stream wording for the Bzila entry form. Keeps the source-specific
// labels/defaults in one place instead of ternaries at each field.
const PROP_SOURCE_UI: Record<PropSource, {
  label: string;
  defaultFirm: string;
  firmPlaceholder: string;
  costLabel: string;
  payoutLabel: string;
}> = {
  prop:      { label: "Prop",      defaultFirm: "TPT",      firmPlaceholder: "Firm",            costLabel: "− Purchase", payoutLabel: "+ Payout" },
  cbedge:    { label: "CB Edge",   defaultFirm: "CB EDGE",  firmPlaceholder: "Source / vendor", costLabel: "− Spend",    payoutLabel: "+ Earnings" },
  contracts: { label: "Contracts", defaultFirm: "CONTRACT", firmPlaceholder: "Client",          costLabel: "− Expense",  payoutLabel: "+ Invoice" },
};
type PropRow = { id: number; entry_date: string; source: PropSource; firm: string; accounts: number; cost: number; payout: number; note?: string | null };
// A Bzila ledger line, normalized across all three streams (prop + cbedge come
// from budget_prop; contracts are read out of the Payments register).
type BzilaEntry = { key: string; id: number | null; date: string; stream: "prop" | "cbedge" | "contracts"; label: string; accounts: number; inAmt: number; outAmt: number };
const STREAM_LABEL: Record<BzilaEntry["stream"], string> = { prop: "Prop", cbedge: "CB Edge", contracts: "Contracts" };
type Frequency = "weekly" | "biweekly" | "monthly";
type RecurringRule = { id: number; label: string; bank: Bank; amount: number; frequency: Frequency; anchor_date: string; active: number };
type Intel = {
  daysInMonth: number; todayDay: number; daysLeft: number; billsLeft: number;
  safe: number; safePerDay: number; cum: number[]; budgetTotal: number;
  paceNow: number; spentMtd: number;
  week: { date: string; net: number; out: number }[];
  wkOut: number; prevWkOut: number;
  /** `avg` = what this category costs in a typical month; null when the window
      is not a whole month, or when there is no history to average. */
  slices: { label: string; value: number; color: string; avg: number | null }[];
};

// Red standardized to theme's #EF4444 — amounts, deficits and delete accents.
const SOFT_RED = HOME_THEME.red;

// ── Elevated dark surface set (premium contrast pass) ────────────────────────
// Page-local tokens, one step deeper than HOME_THEME.bg/panel so metrics pop.
// Cards stay SOLID (no blur/radial) — this deepens, it does not re-skin.
const INK = "#020308";                         // page background — near-black
const PANEL = "#0B101B";                       // solid card fill — lifted off the ink
const HAIRLINE = "rgba(255,255,255,0.16)";     // card edge — clearly visible
const EDGE_LIGHT = "inset 0 1px 0 rgba(255,255,255,0.12)"; // machined top edge
const CARD_SHADOW = `${EDGE_LIGHT}, 0 2px 4px rgba(0,0,0,0.6), 0 24px 60px -16px rgba(0,0,0,0.75)`;
const SHELL_GLOW_DEEP = `radial-gradient(1100px 520px at 12% -10%, rgba(33,158,188,0.13) 0%, transparent 60%), radial-gradient(900px 460px at 88% 6%, rgba(125,211,252,0.09) 0%, transparent 55%), ${HOME_THEME.shellGlow}`;

// Swatch palette for category dots.
const CATEGORY_COLORS = ["#7dd3fc", "#34D399", "#FBBF24", "#F472B6", "#A78BFA", HOME_THEME.red];

// ── Period ──────────────────────────────────────────────────────────────────
// The overview reads as a single month. RangeMode is kept because the window
// helpers below are written in terms of it, but the page is pinned to monthly.
type RangeMode = "daily" | "weekly" | "monthly" | "yearly";
const RANGE_WINDOW_LABEL: Record<RangeMode, string> = { daily: "Today", weekly: "Last 7 days", monthly: "This month", yearly: "This year" };

// Chart palette lifted straight from /owner/charts-ui so every chart on this
// page reads as the same family as the reference page.
const CHART = {
  cyan: "#219EBC",
  lightBlue: "#7dd3fc",
  gold: "#FFB703",
  orange: "#FB8501",
  red: HOME_THEME.red,
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.45)",
} as const;

const BANKS: Bank[] = ["coastal", "truist", "secu"];
const BANK_LABEL: Record<Bank, string> = { coastal: "COASTAL", truist: "TRUIST", secu: "SECU" };
const FREQS: Frequency[] = ["weekly", "biweekly", "monthly"];
const FREQ_LABEL: Record<Frequency, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
}
// Short "M-D" like the screenshot (7-1).
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}-${d}`;
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayIso(): string {
  return isoDate(new Date());
}
function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return isoDate(dt);
}
function daysBetween(aIso: string, bIso: string): number {
  const [ay, am, ad] = aIso.split("-").map(Number);
  const [by, bm, bd] = bIso.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// All dates a recurring rule fires within "YYYY-MM". Weekly/biweekly step from
// the anchor by 7/14 days; monthly repeats on the anchor's day-of-month
// (clamped to the month's length so the 31st still lands in shorter months).
function occurrencesInMonth(rule: RecurringRule, month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const out: string[] = [];

  if (rule.frequency === "monthly") {
    const day = Math.min(Number(rule.anchor_date.split("-")[2]), lastDay);
    out.push(`${month}-${String(day).padStart(2, "0")}`);
    return out;
  }

  const step = rule.frequency === "weekly" ? 7 : 14;
  let cursor = rule.anchor_date;
  // Walk back to just before the month, then forward through it.
  while (cursor > first) cursor = addDays(cursor, -step);
  while (cursor < first) cursor = addDays(cursor, step);
  let guard = 0;
  while (cursor <= last && guard < 10) {
    out.push(cursor);
    cursor = addDays(cursor, step);
    guard++;
  }
  return out;
}

export default function Budget() {
  const [profile, setProfile] = useState<BudgetProfile | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [register, setRegister] = useState<RegisterRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringRule[]>([]);
  const [amazonRows, setAmazonRows] = useState<AmazonRow[]>([]);
  const [propRows, setPropRows] = useState<PropRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dailyBalance, setDailyBalance] = useState<DailyBalance | null>(null);
  const [prevDailyBalance, setPrevDailyBalance] = useState<DailyBalance | null>(null);
  const [weekAgoBalance, setWeekAgoBalance] = useState<DailyBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "register" | "real" | "categories" | "amazon" | "bzila" | "yearly">("overview");
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [yearRows, setYearRows] = useState<RegisterRow[]>([]);
  const [yearLoading, setYearLoading] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  // Calendar / Projection toggle on the right-hand overview card. The
  // projection was lost when this page was ported out of the Next route; its
  // smoothPath() helper stayed behind, unused, which is how it was found.
  const [rightTab, setRightTab] = useState<"calendar" | "projection">("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // The overview reads as a single month.
  const range: RangeMode = "monthly";
  // Cash Flow is always day-by-day across the month in the picker.
  const cfMode: RangeMode = "daily";
  // Spend Pace is pinned to the SELECTED MONTH, day by day. It used to follow
  // the range tab, which on this page means "monthly" — so the card drew
  // Jan–Dec against a 12× budget: a year-shaped answer to a month-shaped
  // question, sitting in a row of month-scoped tiles.
  const paceRange: RangeMode = "daily";

  // Add-row composer
  const [rwDate, setRwDate] = useState(todayIso());
  const [rwLabel, setRwLabel] = useState("");
  const [rwBank, setRwBank] = useState<Bank>("secu");
  const [rwSign, setRwSign] = useState<"-" | "+">("-"); // payments default negative
  const [rwAmount, setRwAmount] = useState("");

  // Recurring rules manager
  const [showRecurring, setShowRecurring] = useState(false);

  // Amazon composer
  const [azDate, setAzDate] = useState(todayIso());
  const [azPay, setAzPay] = useState("");
  const [azGas, setAzGas] = useState("");

  // Bzila composer
  const [ppDate, setPpDate] = useState(todayIso());
  const [ppSource, setPpSource] = useState<PropSource>("prop");
  const [ppFirm, setPpFirm] = useState("TPT");
  const [ppAccounts, setPpAccounts] = useState("1");
  const [ppCost, setPpCost] = useState("");
  const [ppKind, setPpKind] = useState<"cost" | "payout">("cost");

  const currency = profile?.currency || "USD";

  const refresh = async (m = month) => {
    setLoading(true);
    const res = await fetch(`/api/budget?month=${m}`, { cache: "no-store" });
    const data = await res.json();
    setProfile(data.profile);
    setRegister(data.register || []);
    setRecurring(data.recurring || []);
    setAmazonRows(data.amazonRows || []);
    setPropRows(data.propRows || []);
    setCategories(data.categories || []);
    setDailyBalance(data.dailyBalance || null);
    setPrevDailyBalance(data.prevDailyBalance || null);
    setWeekAgoBalance(data.weekAgoBalance || null);
    setLoading(false);
  };

  useEffect(() => {
    void refresh(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Reset the calendar selection when the month changes.
  useEffect(() => {
    setSelectedDate(null);
  }, [month]);

  // Bzila reads propRows (loaded for the selected month's year) alongside
  // yearRows (loaded for `year`). Keep them on the same year or the Contracts
  // stream would be off by a year.
  useEffect(() => {
    if (tab !== "bzila") return;
    const y = Number(month.slice(0, 4));
    if (y && y !== year) setYear(y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, month]);

  // Load a whole year of register rows for the Yearly tab and for the Overview's
  // monthly cash-flow bucket.
  useEffect(() => {
    // Bzila needs the year's register rows too — its Contracts stream is read
    // from the Payments register rather than entered on the tab.
    if (tab !== "yearly" && tab !== "overview" && tab !== "bzila") return;
    let cancelled = false;
    (async () => {
      setYearLoading(true);
      try {
        const res = await fetch(`/api/budget/year?year=${year}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setYearRows(data.rows || []);
      } finally {
        if (!cancelled) setYearLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, year]);

  const post = async (payload: Record<string, unknown>) => {
    await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileName: profile?.name ?? "Default", ...payload }),
    });
    await refresh(month);
  };

  // Build the displayed register: seed per-bank beginning balances, then merge
  // manual rows with live-computed recurring occurrences (sorted by date), then
  // run each bank's own running balance. Recurring rows are synthetic (id<0).
  const computed = useMemo(() => {
    const bal: Record<Bank, number> = { coastal: 0, truist: 0, secu: 0 };
    const beginningByBank: Record<Bank, number | null> = { coastal: null, truist: null, secu: null };

    for (const r of register) {
      if (r.is_beginning) {
        bal[r.bank] = r.amount;
        beginningByBank[r.bank] = r.amount;
      }
    }
    const anyBeginning = BANKS.some((b) => beginningByBank[b] !== null);

    // Manual (non-beginning) rows.
    type Line = { id: number; entry_date: string; sort_order: number; label: string; bank: Bank; amount: number; recurring: boolean; recurTag?: string };
    const lines: Line[] = register
      .filter((r) => !r.is_beginning)
      .map((r) => ({ id: r.id, entry_date: r.entry_date, sort_order: r.sort_order, label: r.label, bank: r.bank, amount: r.amount, recurring: false }));

    // A recurring occurrence the user edited is "materialized" into a real
    // register row tagged __recur__:<ruleId>:<date>. Skip the synthetic twin so
    // that instance isn't double-counted — the real (editable) row stands in.
    const materialized = new Set(
      register
        .filter((r) => !r.is_beginning && typeof r.recurring_tag === "string" && r.recurring_tag.startsWith("__recur__:"))
        .map((r) => r.recurring_tag as string)
    );

    // Recurring occurrences for this month (synthetic negative ids per rule+date).
    for (const rule of recurring) {
      if (!rule.active) continue;
      for (const date of occurrencesInMonth(rule, month)) {
        const tag = `__recur__:${rule.id}:${date}`;
        if (materialized.has(tag)) continue;
        lines.push({ id: -(rule.id * 100 + Number(date.split("-")[2])), entry_date: date, sort_order: 40, label: rule.label, bank: rule.bank, amount: rule.amount, recurring: true, recurTag: tag });
      }
    }

    lines.sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.sort_order - b.sort_order));

    const rows: ComputedRow[] = [];
    if (anyBeginning) {
      const bc = (beginningByBank.coastal ?? 0) + (beginningByBank.truist ?? 0) + (beginningByBank.secu ?? 0);
      rows.push({
        id: -1, entry_date: register.find((r) => r.is_beginning)?.entry_date ?? `${month}-01`,
        label: "BEGINNING", bank: "secu", amount: 0, is_beginning: 1, recurring: false,
        balance: bc, balances: { ...bal }, total: bal.coastal + bal.truist + bal.secu,
      });
    }

    // Single combined running balance carried down the page (matches the sheet's
    // BALANCE column). Seeded from the sum of the per-bank beginning balances.
    const beginCombined = (beginningByBank.coastal ?? 0) + (beginningByBank.truist ?? 0) + (beginningByBank.secu ?? 0);
    let running = beginCombined;

    let income = 0;
    let payments = 0;
    const series: { date: string; balance: number }[] = anyBeginning ? [{ date: `${month}-01`, balance: beginCombined }] : [];
    const expenseByLabel: Record<string, number> = {};

    for (const ln of lines) {
      bal[ln.bank] += ln.amount;
      running += ln.amount;
      if (ln.amount > 0) income += ln.amount;
      else {
        payments += ln.amount;
        expenseByLabel[ln.label] = (expenseByLabel[ln.label] || 0) + Math.abs(ln.amount);
      }
      rows.push({ id: ln.id, entry_date: ln.entry_date, label: ln.label, bank: ln.bank, amount: ln.amount, is_beginning: 0, recurring: ln.recurring, recurTag: ln.recurTag, balance: running, balances: { ...bal }, total: bal.coastal + bal.truist + bal.secu });
      series.push({ date: ln.entry_date, balance: running });
    }

    // Group real (non-beginning) rows by day. The beginning balance is rendered
    // separately as a header strip, so it never forms an empty day group.
    const groupMap = new Map<string, { date: string; rows: typeof rows; dailyNet: number; eod: number }>();
    for (const r of rows) {
      if (r.is_beginning) continue;
      const key = r.entry_date;
      if (!groupMap.has(key)) groupMap.set(key, { date: key, rows: [], dailyNet: 0, eod: beginCombined });
      const g = groupMap.get(key)!;
      g.rows.push(r);
      g.dailyNet += r.amount;
      g.eod = r.balance; // running balance after this row; last row in group = EOD
    }
    const groups = Array.from(groupMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

    const topExpenses = Object.entries(expenseByLabel)
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    return {
      rows, groups, series, topExpenses,
      income, payments, netCashFlow: income + payments,
      projectedBalance: running,
      beginningByBank, anyBeginning, beginningBalance: beginCombined,
      totals: { ...bal }, grandTotal: bal.coastal + bal.truist + bal.secu,
    };
  }, [register, recurring, month]);

  const amazonComputed = useMemo(() => {
    const rows = amazonRows.map((r) => ({ ...r, net: r.pay - r.gas }));
    const totalPay = rows.reduce((s, r) => s + r.pay, 0);
    const totalGas = rows.reduce((s, r) => s + r.gas, 0);
    return { rows, totalPay, totalGas, totalNet: totalPay - totalGas };
  }, [amazonRows]);

  // Bzila — the business ledger. Three streams merged into one set of entries:
  //   prop + cbedge + contracts → budget_prop rows (entered on this tab)
  //   contracts                 → ALSO picked up from Payments register rows in a
  //                               Contracts category (read only). Enter a contract
  //                               here or there, not both.
  // Grouped by month (newest first) with per-stream and year totals.
  const bzilaComputed = useMemo(() => {
    const contractCatIds = new Set(categories.filter((c) => /contract/i.test(c.name)).map((c) => c.id));
    const entries: BzilaEntry[] = [];

    for (const r of propRows) {
      entries.push({
        key: `p${r.id}`,
        id: r.id,
        date: r.entry_date,
        stream: r.source === "cbedge" ? "cbedge" : r.source === "contracts" ? "contracts" : "prop",
        label: r.firm,
        accounts: r.accounts || 0,
        inAmt: r.payout || 0,
        outAmt: r.cost || 0,
      });
    }
    for (const r of yearRows) {
      if (r.is_beginning) continue;
      const isContract = (r.category_id != null && contractCatIds.has(r.category_id)) || /contract/i.test(r.label);
      if (!isContract) continue;
      entries.push({
        key: `r${r.id}`,
        id: null, // read-only here — edit it on the Payments tab
        date: r.entry_date,
        stream: "contracts",
        label: r.label,
        accounts: 0,
        inAmt: r.amount > 0 ? r.amount : 0,
        outAmt: r.amount < 0 ? Math.abs(r.amount) : 0,
      });
    }

    const byMonth = new Map<string, BzilaEntry[]>();
    for (const e of entries) {
      const ym = e.date.slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(e);
    }
    const months = Array.from(byMonth.entries())
      .map(([ym, rows]) => {
        rows.sort((a, b) => (a.date < b.date ? 1 : -1));
        const inAmt = rows.reduce((s, r) => s + r.inAmt, 0);
        const outAmt = rows.reduce((s, r) => s + r.outAmt, 0);
        return { ym, rows, inAmt, outAmt, net: inAmt - outAmt };
      })
      .sort((a, b) => (a.ym < b.ym ? 1 : -1));

    const streamTotal = (s: BzilaEntry["stream"]) => {
      const rows = entries.filter((e) => e.stream === s);
      const inAmt = rows.reduce((x, r) => x + r.inAmt, 0);
      const outAmt = rows.reduce((x, r) => x + r.outAmt, 0);
      return { inAmt, outAmt, net: inAmt - outAmt };
    };
    const totalIn = entries.reduce((s, r) => s + r.inAmt, 0);
    const totalOut = entries.reduce((s, r) => s + r.outAmt, 0);
    return {
      months,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      streams: { cbedge: streamTotal("cbedge"), contracts: streamTotal("contracts"), prop: streamTotal("prop") },
    };
  }, [propRows, yearRows, categories]);

  // Spend per category (this month's expense rows) + the "unsorted" bucket +
  // the actual rows grouped by category (for the per-category detail popup).
  const categoryStats = useMemo(() => {
    const spent: Record<number, number> = {};
    const unsorted: RegisterRow[] = [];
    const byCategory: Record<number, RegisterRow[]> = {};
    for (const r of register) {
      if (r.is_beginning || r.amount >= 0) continue;
      if (r.category_id == null) unsorted.push(r);
      else {
        spent[r.category_id] = (spent[r.category_id] || 0) + Math.abs(r.amount);
        (byCategory[r.category_id] ||= []).push(r);
      }
    }
    unsorted.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    for (const k of Object.keys(byCategory)) byCategory[Number(k)].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    const unsortedTotal = unsorted.reduce((s, r) => s + Math.abs(r.amount), 0);
    return { spent, unsorted, unsortedTotal, byCategory };
  }, [register]);

  // Upcoming recurring payments in the next ~10 days not yet logged (materialized).
  const billsDue = useMemo(() => {
    const today = todayIso();
    const horizon = addDays(today, 10);
    const materialized = new Set(
      register.filter((r) => !r.is_beginning && !!r.recurring_tag && r.recurring_tag.startsWith("__recur__:")).map((r) => r.recurring_tag as string)
    );
    const out: { label: string; amount: number; date: string; days: number; tag: string; bank: Bank }[] = [];
    for (const rule of recurring) {
      if (!rule.active || rule.amount >= 0) continue;
      for (const date of occurrencesInMonth(rule, month)) {
        if (date > horizon) continue;
        const tag = `__recur__:${rule.id}:${date}`;
        if (materialized.has(tag)) continue;
        out.push({ label: rule.label, amount: rule.amount, date, days: daysBetween(today, date), tag, bank: rule.bank });
      }
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  }, [recurring, register, month]);

  // Per-month rollup for the Yearly tab: real rows + non-materialized recurring
  // occurrences, chaining start→end and honoring any month that sets its own
  // beginning balance (which resets the running start for that month).
  const yearMonths = useMemo(() => {
    const byMonth: Record<string, RegisterRow[]> = {};
    for (const r of yearRows) {
      const ym = r.entry_date.slice(0, 7);
      (byMonth[ym] ||= []).push(r);
    }
    let carry = 0;
    const months: { ym: string; m: number; start: number; income: number; expenses: number; end: number; leftover: number; active: boolean }[] = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, "0")}`;
      const rows = byMonth[ym] || [];
      const beginRows = rows.filter((r) => r.is_beginning);
      const real = rows.filter((r) => !r.is_beginning);
      const materialized = new Set(real.filter((r) => !!r.recurring_tag && r.recurring_tag.startsWith("__recur__:")).map((r) => r.recurring_tag as string));
      let income = 0;
      let expenses = 0;
      for (const r of real) {
        if (r.amount > 0) income += r.amount;
        else expenses += Math.abs(r.amount);
      }
      for (const rule of recurring) {
        if (!rule.active) continue;
        for (const date of occurrencesInMonth(rule, ym)) {
          const tag = `__recur__:${rule.id}:${date}`;
          if (materialized.has(tag)) continue;
          if (rule.amount > 0) income += rule.amount;
          else expenses += Math.abs(rule.amount);
        }
      }
      const hasBegin = beginRows.length > 0;
      const start = hasBegin ? beginRows.reduce((s, r) => s + r.amount, 0) : carry;
      const leftover = income - expenses;
      const end = start + leftover;
      carry = end;
      months.push({ ym, m, start, income, expenses, end, leftover, active: rows.length > 0 || income !== 0 || expenses !== 0 });
    }
    const totals = months.reduce(
      (a, x) => ({ income: a.income + x.income, expenses: a.expenses + x.expenses, leftover: a.leftover + x.leftover }),
      { income: 0, expenses: 0, leftover: 0 }
    );
    // Spend by category across the whole year (assigned real expense rows).
    const catSpend: Record<number, number> = {};
    let uncategorized = 0;
    for (const r of yearRows) {
      if (r.is_beginning || r.amount >= 0) continue;
      if (r.category_id == null) uncategorized += Math.abs(r.amount);
      else catSpend[r.category_id] = (catSpend[r.category_id] || 0) + Math.abs(r.amount);
    }
    return { months, totals, start: months[0]?.start ?? 0, end: months[11]?.end ?? 0, catSpend, uncategorized };
  }, [yearRows, recurring, year]);

  // ── Overview derived data ────────────────────────────────────────────────
  // Live "all banks" figure: today's entered opening balance if we have one,
  // otherwise the month's beginning balances.
  const bankNow: Record<Bank, number> = useMemo(() => {
    if (dailyBalance) return { coastal: dailyBalance.coastal, truist: dailyBalance.truist, secu: dailyBalance.secu };
    return {
      coastal: computed.beginningByBank.coastal ?? 0,
      truist: computed.beginningByBank.truist ?? 0,
      secu: computed.beginningByBank.secu ?? 0,
    };
  }, [dailyBalance, computed.beginningByBank]);
  const allBanks = bankNow.coastal + bankNow.truist + bankNow.secu;

  // ── Daily/weekly budgeting intelligence (client-computed, no new APIs) ─────
  // Safe-to-spend, budget pace, category donut slices, 7-day pulse.
  const intel = useMemo(() => {
    const today = todayIso();
    const [iy, im] = month.split("-").map(Number);
    const daysInMonth = new Date(iy, im, 0).getDate();
    const todayDay = today.slice(0, 7) === month ? Number(today.split("-")[2]) : today.slice(0, 7) > month ? daysInMonth : 0;
    const daysLeft = Math.max(1, daysInMonth - todayDay + 1);

    // Bills still due: active negative recurring occurrences from today → EOM,
    // minus any the user already materialized into real rows.
    const materialized = new Set(
      register.filter((r) => !r.is_beginning && !!r.recurring_tag && r.recurring_tag.startsWith("__recur__:")).map((r) => r.recurring_tag as string)
    );
    let billsLeft = 0;
    for (const rule of recurring) {
      if (!rule.active || rule.amount >= 0) continue;
      for (const date of occurrencesInMonth(rule, month)) {
        if (date < today) continue;
        if (materialized.has(`__recur__:${rule.id}:${date}`)) continue;
        billsLeft += Math.abs(rule.amount);
      }
    }
    const safe = allBanks - billsLeft;
    const safePerDay = safe / daysLeft;

    // Cumulative spend by day-of-month (expenses only).
    const spendByDay = new Array<number>(daysInMonth).fill(0);
    for (const g of computed.groups) {
      const d = Number(g.date.split("-")[2]) - 1;
      if (d < 0 || d >= daysInMonth) continue;
      for (const r of g.rows) if (r.amount < 0) spendByDay[d] += -r.amount;
    }
    const cum: number[] = [];
    let acc = 0;
    for (let i = 0; i < daysInMonth; i++) { acc += spendByDay[i]; cum.push(acc); }
    const budgetTotal = categories.reduce((s, c) => s + (c.amount || 0), 0) || Math.abs(computed.payments) || 1;
    const paceNow = (budgetTotal * Math.min(Math.max(todayDay, 0), daysInMonth)) / daysInMonth;
    const spentMtd = todayDay > 0 ? cum[Math.min(todayDay, daysInMonth) - 1] ?? 0 : 0;

    // 7-day pulse vs prior 7 days (days outside the loaded month read as 0).
    const dayAgg = (iso: string) => {
      const g = computed.groups.find((gr) => gr.date === iso);
      let net = 0, out = 0;
      if (g) for (const r of g.rows) { net += r.amount; if (r.amount < 0) out += -r.amount; }
      return { net, out };
    };
    const week: { date: string; net: number; out: number }[] = [];
    let wkOut = 0, prevWkOut = 0;
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const a = dayAgg(d);
      week.push({ date: d, ...a });
      wkOut += a.out;
    }
    for (let i = 13; i >= 7; i--) prevWkOut += dayAgg(addDays(today, -i)).out;

    // Donut slices: per-category spend + the unsorted bucket.
    const slices = categories
      .map((c, i) => ({ label: c.name, value: categoryStats.spent[c.id] || 0, color: c.color || CATEGORY_COLORS[i % CATEGORY_COLORS.length], avg: null as number | null }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    if (categoryStats.unsortedTotal > 0) slices.push({ label: "Unsorted", value: categoryStats.unsortedTotal, color: "rgba(255,255,255,0.35)", avg: null });

    return { daysInMonth, todayDay, daysLeft, billsLeft, safe, safePerDay, cum, budgetTotal, paceNow, spentMtd, week, wkOut, prevWkOut, slices };
  }, [register, recurring, month, allBanks, categories, categoryStats, computed]);
  const prevAllBanks = prevDailyBalance ? prevDailyBalance.coastal + prevDailyBalance.truist + prevDailyBalance.secu : null;

  // ── Balance reconciliation (weekly) ───────────────────────────────────────
  // Anchor on the balance from ~a week back (weekAgoBalance), falling back to the
  // immediately prior entry. Only count CLEARED money — real register rows,
  // i.e. bills you've hit "Pay" on in Upcoming Pay (recurring:false). Upcoming
  // bills still scheduled or past due (synthetic recurring:true) haven't left the
  // bank yet, so they're skipped and don't throw the number off. Expected =
  // anchor + cleared in − cleared out; drift = actual entered balance − expected.
  // A negative drift means money left that wasn't logged (go hit Pay on it).
  const reconcile = useMemo(() => {
    const anchor = weekAgoBalance ?? prevDailyBalance;
    if (!dailyBalance || !anchor) return null;
    const anchorTotal = anchor.coastal + anchor.truist + anchor.secu;
    const from = anchor.day; // exclusive
    const to = dailyBalance.day; // inclusive
    if (!(to > from)) return null;
    let moneyIn = 0, moneyOut = 0, uncleared = 0;
    for (const g of computed.groups) {
      if (g.date <= from || g.date > to) continue;
      for (const r of g.rows) {
        if (r.is_beginning) continue;
        if (r.recurring) { if (r.amount < 0) uncleared += -r.amount; continue; } // scheduled bill, not paid yet
        if (r.amount > 0) moneyIn += r.amount;
        else moneyOut += -r.amount;
      }
    }
    const expected = anchorTotal + moneyIn - moneyOut;
    const drift = allBanks - expected; // + more cash than expected, − missing cash
    return { from, to, days: daysBetween(from, to), prevBalance: anchorTotal, moneyIn, moneyOut, uncleared, expected, actual: allBanks, drift };
  }, [dailyBalance, prevDailyBalance, weekAgoBalance, allBanks, computed.groups]);

  // Bzila net for the selected month (all three streams). Shown as its own tile
  // — deliberately NOT rolled into the Income / Net Profit tiles, which stay
  // personal-only.
  const bzilaMonth = useMemo(
    () => bzilaComputed.months.find((m) => m.ym === month) ?? { inAmt: 0, outAmt: 0, net: 0 },
    [bzilaComputed, month]
  );

  // Cash-flow buckets (in vs out) at day / week / month resolution.
  const cashflow = useMemo(() => {
    if (cfMode === "yearly") {
      // The year at a glance — four quarter buckets.
      return [1, 2, 3, 4].map((q) => {
        const ms = yearMonths.months.filter((mo) => Math.floor((mo.m - 1) / 3) + 1 === q);
        return {
          label: `Q${q}`,
          inflow: ms.reduce((s, mo) => s + mo.income, 0),
          outflow: ms.reduce((s, mo) => s + mo.expenses, 0),
        };
      });
    }
    if (cfMode === "monthly") {
      return yearMonths.months.map((mo) => ({
        label: new Date(2000, mo.m - 1, 1).toLocaleDateString("en-US", { month: "short" }),
        inflow: mo.income,
        outflow: mo.expenses,
      }));
    }
    const days = computed.groups.map((g) => {
      let inflow = 0, outflow = 0;
      for (const r of g.rows) { if (r.amount > 0) inflow += r.amount; else outflow += Math.abs(r.amount); }
      return { date: g.date, inflow, outflow };
    });
    if (cfMode === "daily") return days.map((d) => ({ label: shortDate(d.date), inflow: d.inflow, outflow: d.outflow }));
    // weekly — bucket by week-of-month (day 1-7 = W1, …)
    const weeks = new Map<number, { inflow: number; outflow: number }>();
    for (const d of days) {
      const w = Math.floor((Number(d.date.slice(8, 10)) - 1) / 7) + 1;
      const cur = weeks.get(w) || { inflow: 0, outflow: 0 };
      cur.inflow += d.inflow;
      cur.outflow += d.outflow;
      weeks.set(w, cur);
    }
    return Array.from(weeks.entries()).sort((a, b) => a[0] - b[0]).map(([w, v]) => ({ label: `W${w}`, inflow: v.inflow, outflow: v.outflow }));
  }, [cfMode, computed.groups, yearMonths.months]);

  // ── Windowed spend, bucketed by period ───────────────────────────────────
  // Feeds the SUMMARY cards (Safe to Spend, Where It Went, Category Spend).
  // Reads from the year's rows when they're loaded so "today" and "last 7 days"
  // stay correct across a month boundary; falls back to the month's rows.
  const spendWindow = useMemo(() => {
    const today = todayIso();
    const weekFrom = addDays(today, -6);
    const rows = yearRows.length ? yearRows : register;
    const yearStr = String(year);
    const match: Record<RangeMode, (d: string) => boolean> = {
      daily: (d) => d === today,
      weekly: (d) => d >= weekFrom && d <= today,
      monthly: (d) => d.slice(0, 7) === month,
      yearly: (d) => d.slice(0, 4) === yearStr,
    };
    const build = (mode: RangeMode) => {
      const ok = match[mode];
      const byCat: Record<number, number> = {};
      let unsorted = 0, unsortedCount = 0, spend = 0, income = 0, count = 0;
      for (const r of rows) {
        if (r.is_beginning || !ok(r.entry_date)) continue;
        if (r.amount > 0) { income += r.amount; continue; }
        const v = Math.abs(r.amount);
        spend += v; count++;
        if (r.category_id == null) { unsorted += v; unsortedCount++; }
        else byCat[r.category_id] = (byCat[r.category_id] || 0) + v;
      }
      return { byCat, unsorted, unsortedCount, spend, income, count };
    };
    return { daily: build("daily"), weekly: build("weekly"), monthly: build("monthly"), yearly: build("yearly") };
  }, [yearRows, register, month, year]);

  // Donut slices for whichever window the "Where It Went" card is showing.
  // What each category costs in a typical month, from the same register
  // history the pace curve reads. Averaged over the months that HAVE rows and
  // never over the month being displayed — a category is compared against its
  // own past, not against a divisor that changes with how far back the data
  // happens to reach.
  const categoryAvg = useMemo(() => {
    const perMonth = new Map<string, Map<number | null, number>>();
    for (const r of yearRows) {
      if (r.is_beginning || r.amount >= 0) continue;
      const ym = r.entry_date.slice(0, 7);
      if (ym === month) continue;
      const slot = perMonth.get(ym) ?? new Map<number | null, number>();
      const k = r.category_id ?? null;
      slot.set(k, (slot.get(k) ?? 0) + Math.abs(r.amount));
      perMonth.set(ym, slot);
    }
    const n = perMonth.size;
    const byCat = new Map<number | null, number>();
    if (n) {
      for (const slot of perMonth.values()) {
        for (const [k, v] of slot) byCat.set(k, (byCat.get(k) ?? 0) + v);
      }
      // A category absent from a month counts as a zero for that month, which
      // is correct here: the register covers every month it has rows for, so a
      // missing category means nothing was spent, not that nothing is known.
      for (const [k, v] of byCat) byCat.set(k, v / n);
    }
    return { byCat, months: n };
  }, [yearRows, month]);

  const slicesFor = useCallback((mode: RangeMode) => {
    const w = spendWindow[mode];
    // The average is only comparable to a whole month's spend, so it rides
    // along only on the monthly view. On a 7-day window "vs typical month"
    // would compare a week against a month and always read wildly under.
    const withAvg = mode === "monthly" && categoryAvg.months > 0;
    const out = categories
      .map((c, i) => ({
        label: c.name,
        value: w.byCat[c.id] || 0,
        color: c.color || CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        avg: withAvg ? categoryAvg.byCat.get(c.id) ?? 0 : null,
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    if (w.unsorted > 0) out.push({ label: "Unsorted", value: w.unsorted, color: "rgba(255,255,255,0.35)", avg: withAvg ? categoryAvg.byCat.get(null) ?? 0 : null });
    return out;
  }, [spendWindow, categories, categoryAvg]);

  // ── Spend pace ────────────────────────────────────────────────────────────
  // Cumulative spend vs a straight-line budget AND vs a typical month. The
  // card itself is pinned to `paceRange` = daily (the selected month, day by
  // day); the other buckets stay here because they are correct and the pin is
  // a display decision, not a data one. Budget scales with the span (monthly
  // budget × 12 for the year-wide views), so "over/under pace" would mean the
  // same thing at any resolution.
  const paceSeries = useMemo(() => {
    const monthBudget = intel.budgetTotal;
    const yearBudget = monthBudget * 12;
    const daysInMonth = intel.daysInMonth;
    const spendByDay = new Array<number>(daysInMonth).fill(0);
    for (const g of computed.groups) {
      const d = Number(g.date.split("-")[2]) - 1;
      if (d < 0 || d >= daysInMonth) continue;
      for (const r of g.rows) if (r.amount < 0) spendByDay[d] += -r.amount;
    }
    const cumulate = (vals: number[]) => { let a = 0; return vals.map((v) => (a += v)); };
    const nowMonth = Number(todayIso().slice(5, 7));
    const yearIsCurrent = String(year) === todayIso().slice(0, 4);
    const monthsUpTo = yearIsCurrent ? nowMonth : String(year) < todayIso().slice(0, 4) ? 12 : 0;
    const monthShort = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // ── the benchmark: a typical month's SHAPE, day by day ──────────────────
    //
    // A straight ramp is the wrong reference for this data. Rent and the big
    // bills clear in the first few days, so cumulative spend jumps most of the
    // month's total before the 5th and then crawls. Against a straight line
    // that reads "massively over pace" every single month until the line
    // catches up near the 25th — a red badge that is always red, which tells
    // you nothing.
    //
    // So the benchmark is the average of the PRIOR months' own day-by-day
    // curves. The rent step is in the benchmark too, and "ahead of a normal
    // month on the 16th" becomes a real statement.
    const avgCurve = (() => {
      const spendByMonth = new Map<string, number[]>();
      for (const r of yearRows) {
        if (r.is_beginning || r.amount >= 0) continue;
        const ym = r.entry_date.slice(0, 7);
        // Never average a month into its own benchmark.
        if (ym === month) continue;
        const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
        const arr = spendByMonth.get(ym) ?? new Array<number>(dim).fill(0);
        const d = Number(r.entry_date.slice(8, 10)) - 1;
        if (d >= 0 && d < arr.length) arr[d] += -r.amount;
        spendByMonth.set(ym, arr);
      }

      const curves: number[][] = [];
      for (const arr of spendByMonth.values()) {
        if (!arr.some((v) => v > 0)) continue;
        let a = 0;
        const c = arr.map((v) => (a += v));
        // Resample onto the loaded month's length so a 28-day February and a
        // 31-day March line up by POSITION in the month, not by raw index —
        // otherwise February contributes nothing to days 29-31 and drags the
        // tail of the average down.
        curves.push(
          Array.from({ length: daysInMonth }, (_, i) => {
            const pos = daysInMonth === 1 ? 0 : (i / (daysInMonth - 1)) * (c.length - 1);
            const lo = Math.floor(pos);
            const hi = Math.min(c.length - 1, lo + 1);
            return c[lo] + (c[hi] - c[lo]) * (pos - lo);
          })
        );
      }
      if (!curves.length) return null;
      return Array.from({ length: daysInMonth }, (_, i) => curves.reduce((s, c) => s + c[i], 0) / curves.length);
    })();

    const avgN = (() => {
      const seen = new Set<string>();
      for (const r of yearRows) {
        if (r.is_beginning || r.amount >= 0) continue;
        const ym = r.entry_date.slice(0, 7);
        if (ym !== month) seen.add(ym);
      }
      return seen.size;
    })();
    const avgMonth = avgCurve ? avgCurve[avgCurve.length - 1] : 0;

    if (paceRange === "daily") {
      return { cum: intel.cum, labels: intel.cum.map((_, i) => String(i + 1)), budget: monthBudget, avg: avgMonth, avgCum: avgCurve, avgN, upTo: intel.todayDay, span: daysInMonth, scope: monthShort };
    }
    if (paceRange === "weekly") {
      const nWeeks = Math.ceil(daysInMonth / 7);
      const weeks = new Array<number>(nWeeks).fill(0);
      spendByDay.forEach((v, i) => { weeks[Math.floor(i / 7)] += v; });
      const upTo = intel.todayDay > 0 ? Math.floor((intel.todayDay - 1) / 7) + 1 : 0;
      // Weekly buckets the same curve, so the benchmark keeps its shape here too.
      const avgWeeks = avgCurve ? Array.from({ length: nWeeks }, (_, i) => avgCurve[Math.min(daysInMonth - 1, (i + 1) * 7 - 1)]) : null;
      return { cum: cumulate(weeks), labels: weeks.map((_, i) => `W${i + 1}`), budget: monthBudget, avg: avgMonth, avgCum: avgWeeks, avgN, upTo, span: nWeeks, scope: monthShort };
    }
    if (paceRange === "monthly") {
      const vals = yearMonths.months.map((m) => m.expenses);
      return { cum: cumulate(vals), labels: yearMonths.months.map((m) => new Date(2000, m.m - 1, 1).toLocaleDateString("en-US", { month: "narrow" })), budget: yearBudget, avg: avgMonth * 12, avgCum: null, avgN, upTo: monthsUpTo, span: 12, scope: String(year) };
    }
    const quarters = [1, 2, 3, 4].map((q) => yearMonths.months.filter((m) => Math.floor((m.m - 1) / 3) + 1 === q).reduce((s, m) => s + m.expenses, 0));
    return { cum: cumulate(quarters), labels: ["Q1", "Q2", "Q3", "Q4"], budget: yearBudget, avg: avgMonth * 12, avgCum: null, avgN, upTo: Math.ceil(monthsUpTo / 3), span: 4, scope: String(year) };
  }, [paceRange, intel, computed.groups, yearMonths.months, yearRows, year, month]);

  // Income / expenses / net for the month. The monthly
  // view keeps the old behaviour exactly (register totals + Amazon net) so the
  // headline numbers don't move; the other ranges read off the windowed rows.
  const rangeTotals = useMemo(() => {
    if (range === "monthly") {
      const income = computed.income + amazonComputed.totalNet;
      return { income, expenses: Math.abs(computed.payments), net: computed.netCashFlow + amazonComputed.totalNet };
    }
    const w = spendWindow[range];
    return { income: w.income, expenses: w.spend, net: w.income - w.spend };
  }, [range, spendWindow, computed, amazonComputed.totalNet]);

  // Net per day across the whole year — powers the yearly calendar heatmap.
  // Logged rows only (recurring rules aren't projected 12 months out).
  const yearNet = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of yearRows) {
      if (r.is_beginning) continue;
      m.set(r.entry_date, (m.get(r.entry_date) || 0) + r.amount);
    }
    return m;
  }, [yearRows]);

  // Recent transactions = real logged rows (what has actually been paid/received).
  const recentPaid = useMemo(() => {
    return register
      .filter((r) => !r.is_beginning)
      .slice()
      .sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : b.id - a.id))
      .slice(0, 8);
  }, [register]);

  // Upcoming pay — every unlogged recurring outflow left in the month (the alert
  // strip only covers the next 10 days; this is the full remaining obligation).
  const upcomingPay = useMemo(() => {
    const today = todayIso();
    const materialized = new Set(
      register.filter((r) => !r.is_beginning && !!r.recurring_tag && r.recurring_tag.startsWith("__recur__:")).map((r) => r.recurring_tag as string)
    );
    const items: { label: string; amount: number; date: string; bank: Bank; tag: string }[] = [];
    for (const rule of recurring) {
      if (!rule.active || rule.amount >= 0) continue;
      for (const date of occurrencesInMonth(rule, month)) {
        if (date < today) continue;
        const tag = `__recur__:${rule.id}:${date}`;
        if (materialized.has(tag)) continue;
        items.push({ label: rule.label, amount: rule.amount, date, bank: rule.bank, tag });
      }
    }
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
    const total = items.reduce((s, i) => s + Math.abs(i.amount), 0);
    return { items, total, next: items[0] ?? null };
  }, [recurring, register, month]);

  // Rent countdown — rent is due on the 5th. Amount is read from a recurring
  // rule whose label contains "rent". We also project cash flow to the 5th:
  // every OTHER income (e.g. two pay runs) and expense landing before rent,
  // so the card answers "is enough coming in to cover rent when it's due?".
  const rentInfo = useMemo(() => {
    const RENT_DAY = 5;
    const rentRule = recurring.find((r) => r.active && r.amount < 0 && /rent/i.test(r.label));
    const rentAmount = rentRule ? Math.abs(rentRule.amount) : 0;
    const today = todayIso();
    const now = new Date(today + "T00:00:00");
    let due = new Date(now.getFullYear(), now.getMonth(), RENT_DAY);
    if (due.getTime() < now.getTime()) due = new Date(now.getFullYear(), now.getMonth() + 1, RENT_DAY);
    const daysUntil = Math.round((due.getTime() - now.getTime()) / 86400000);
    const dueYm = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}`;
    const dueIso = `${dueYm}-${String(RENT_DAY).padStart(2, "0")}`;
    const paid = register.some((r) => !r.is_beginning && r.amount < 0 && /rent/i.test(r.label) && r.entry_date.slice(0, 7) === dueYm);
    const available = allBanks;

    // Everything landing in [today .. the 5th], rent itself excluded (shown apart):
    // real register rows + non-materialized recurring occurrences (e.g. two pay
    // runs) — so we can answer whether we clear rent when it's due.
    const isRent = (label: string) => /rent/i.test(label);
    const inWindow = (d: string) => d >= today && d <= dueIso;
    const materialized = new Set(
      register
        .filter((r) => !r.is_beginning && typeof r.recurring_tag === "string" && r.recurring_tag.startsWith("__recur__:"))
        .map((r) => r.recurring_tag as string)
    );
    // Calendar months the window touches (this month, plus next if it wraps).
    const months: string[] = [];
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1), g = 0; g < 4; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), g++) {
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push(ym);
      if (ym === dueYm) break;
    }
    type Flow = { label: string; amount: number; date: string };
    const flows: Flow[] = [];
    for (const r of register) {
      if (r.is_beginning || !inWindow(r.entry_date)) continue;
      flows.push({ label: r.label, amount: r.amount, date: r.entry_date });
    }
    for (const rule of recurring) {
      if (!rule.active) continue;
      for (const ym of months) {
        for (const date of occurrencesInMonth(rule, ym)) {
          if (!inWindow(date) || materialized.has(`__recur__:${rule.id}:${date}`)) continue;
          flows.push({ label: rule.label, amount: rule.amount, date });
        }
      }
    }
    flows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const incoming = flows.filter((f) => f.amount > 0);
    const outgoing = flows.filter((f) => f.amount < 0 && !isRent(f.label));
    const incomingTotal = incoming.reduce((s, f) => s + f.amount, 0);
    const outgoingTotal = outgoing.reduce((s, f) => s + Math.abs(f.amount), 0);
    const projected = available + incomingTotal - outgoingTotal; // cash on hand when rent hits
    const shortfall = Math.max(0, rentAmount - projected);
    const perDay = daysUntil > 0 ? shortfall / daysUntil : shortfall;
    return { rentAmount, daysUntil, dueIso, paid, available, incoming, outgoing, incomingTotal, outgoingTotal, projected, shortfall, perDay };
  }, [recurring, register, allBanks]);

  const monthLabel = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  })();

  const addRow = async () => {
    if (!rwLabel.trim() || rwAmount.trim() === "") return;
    const signed = (rwSign === "-" ? -1 : 1) * Math.abs(Number(rwAmount));
    await post({ action: "registerRow", date: rwDate, label: rwLabel.trim().toUpperCase(), bank: rwBank, amount: signed });
    setRwLabel("");
    setRwAmount("");
  };
  const editRow = async (id: number, patch: Record<string, unknown>) => post({ action: "updateRow", id, ...patch });
  const deleteRow = async (id: number) => post({ action: "deleteRow", id });
  // Convert one recurring occurrence into a real, per-instance editable row
  // (the bill changed or was paid early) without touching the recurring rule.
  const materializeRecurring = async (row: ComputedRow) =>
    post({ action: "registerRow", date: row.entry_date, label: row.label, bank: row.bank, amount: row.amount, recurringTag: row.recurTag });
  // Categories.
  const addCategory = async (name: string, amount: number, color: string) =>
    post({ action: "category", name: name.trim(), amount, period: "monthly", color });
  // Recolour an existing category. `action: "category"` upserts on
  // UNIQUE(profile_id, name), so re-posting the same name with a new colour
  // updates the row in place — no new action needed server-side. The current
  // budget amount is passed straight back through so it isn't wiped.
  const updateCategoryColor = async (cat: Category, color: string) =>
    post({ action: "category", name: cat.name, amount: cat.amount || 0, period: "monthly", color });
  const deleteCategory = async (id: number) => post({ action: "categoryDelete", id });
  const assignCategory = async (rowId: number, categoryId: number | null) => post({ action: "assignCategory", id: rowId, categoryId });
  // Log an upcoming recurring bill as paid (materialize this occurrence).
  const markBillPaid = async (bill: { date: string; label: string; bank: Bank; amount: number; tag: string }) =>
    post({ action: "registerRow", date: bill.date, label: bill.label, bank: bill.bank, amount: bill.amount, recurringTag: bill.tag });
  // Daily opening balance (input each morning).
  const saveDailyBalance = async (day: string, coastal: number, truist: number, secu: number) =>
    post({ action: "dailyBalance", day, coastal, truist, secu });
  const addRecurring = async (rule: { label: string; bank: Bank; amount: number; frequency: Frequency; anchorDate: string }) =>
    post({ action: "recurringAdd", ...rule });
  const updateRecurringRule = async (id: number, patch: Record<string, unknown>) =>
    post({ action: "recurringUpdate", id, ...patch });
  const deleteRecurringRule = async (id: number) => post({ action: "recurringDelete", id });
  const saveAmazon = async () => {
    if (azDate.trim() === "" || (azPay.trim() === "" && azGas.trim() === "")) return;
    await post({ action: "amazon", date: azDate, pay: Number(azPay || 0), gas: Number(azGas || 0) });
    setAzPay("");
    setAzGas("");
  };
  const deleteAz = async (id: number) => post({ action: "deleteAmazon", id });
  // Bzila ledger (prop + cbedge + contracts). Contracts can also arrive from the
  // Payments register — see bzilaComputed.
  const addProp = async () => {
    if (ppDate.trim() === "") return;
    const amt = Math.abs(Number(ppCost || 0));
    if (!amt) return;
    await post({
      action: "propAdd",
      date: ppDate,
      source: ppSource,
      firm: ppFirm.trim().toUpperCase() || PROP_SOURCE_UI[ppSource].defaultFirm,
      accounts: ppSource === "prop" && ppKind === "cost" ? Number(ppAccounts || 0) : 0,
      cost: ppKind === "cost" ? amt : 0,
      payout: ppKind === "payout" ? amt : 0,
    });
    setPpCost("");
  };
  const deleteProp = async (id: number) => post({ action: "propDelete", id });

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: INK, backgroundImage: SHELL_GLOW_DEEP, color: HOME_THEME.text, fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px, 2vw, 24px)", gap: 14 }}>
        {/* Title banner */}
        <div style={{ ...cardAccent(4), padding: "14px 18px", overflow: "visible", position: "relative", zIndex: monthPickerOpen ? 80 : "auto" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.28em", color: HOME_THEME.muted, opacity: 0.75 }}>{monthLabel.toUpperCase()}</div>
            <div style={{ fontSize: "clamp(26px, 3.2vw, 38px)", fontWeight: 900, letterSpacing: "0.16em", lineHeight: 1.1, marginTop: 4, textShadow: "0 0 34px rgba(125,211,252,0.55), 0 0 80px rgba(33,158,188,0.35)" }}>BUDGET</div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={labelCap()}>Month</div>
            <ThemedMonthPicker value={month} onChange={setMonth} width={180} onOpenChange={setMonthPickerOpen} />
          </div>
        </div>

        {/* Tabs (top-level nav) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {([["overview", "Overview"], ["register", "Payments"], ["real", "Real Month"], ["categories", "Categories"], ["amazon", "Amazon"], ["bzila", "Bzila"], ["yearly", "Yearly"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={pill(tab === k)}>{l}</button>
          ))}
          {tab === "register" && (
            <button onClick={() => setShowRecurring((v) => !v)} style={{ ...pill(showRecurring), marginLeft: 4 }}>
              🔁 Recurring{recurring.length ? ` (${recurring.filter((r) => r.active).length})` : ""}
            </button>
          )}
          {loading && <span style={{ fontSize: 14, color: HOME_THEME.muted, marginLeft: 6 }}>Loading…</span>}
        </div>

        {showRecurring && tab === "register" && (
          <RecurringManager
            rules={recurring}
            currency={currency}
            onAdd={addRecurring}
            onUpdate={updateRecurringRule}
            onDelete={deleteRecurringRule}
            onClose={() => setShowRecurring(false)}
          />
        )}

        {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
        {tab === "overview" && (
        <>
        {/* Top stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile
            label="All Banks"
            value={fmtMoney(allBanks, currency)}
            sub={dailyBalance ? "Coastal · Truist · SECU" : "Beginning balances"}
            delta={prevAllBanks !== null ? allBanks - prevAllBanks : null}
            currency={currency}
          />
          {/* Month totals — Amazon net is folded into income here. */}
          <StatTile label="Income" value={fmtMoney(rangeTotals.income, currency)} sub={`${RANGE_WINDOW_LABEL[range]} inflows${range === "monthly" ? " · incl. Amazon" : ""}`} valueColor={HOME_THEME.green} />
          <StatTile label="Expenses" value={fmtMoney(rangeTotals.expenses, currency)} sub={`${RANGE_WINDOW_LABEL[range]} outflows`} valueColor={SOFT_RED} />
          <StatTile label="Net Profit" value={fmtMoney(rangeTotals.net, currency)} sub="Income − expenses" valueColor={rangeTotals.net < 0 ? SOFT_RED : HOME_THEME.green} />
          <StatTile label="Amazon" value={fmtMoney(amazonComputed.totalNet, currency)} sub={`${amazonComputed.rows.length} day${amazonComputed.rows.length === 1 ? "" : "s"} · net of gas`} valueColor={amazonComputed.totalNet < 0 ? SOFT_RED : HOME_THEME.text} />
          <StatTile label="Bzila" value={fmtMoney(bzilaMonth.net, currency)} sub={`${fmtMoney(bzilaMonth.inAmt, currency)} in · ${fmtMoney(bzilaMonth.outAmt, currency)} out`} valueColor={bzilaMonth.net < 0 ? SOFT_RED : HOME_THEME.green} />
        </div>

        {/* Daily/weekly budgeting intelligence.
            Two rows, not one row of four. Safe-to-Spend and Balance Check are
            short stat lists and read fine narrow; Spend Pace is a 31-point
            chart and Where It Went is a pie plus a legend — at a quarter of
            the width the chart was a scribble and the legend's percentage
            column was clipped off the right edge. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, alignItems: "stretch" }}>
          <SafeToSpendCard intel={intel} currency={currency} range={range} />
          <BalanceCheckCard data={reconcile} currency={currency} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(430px, 1fr))", gap: 12, alignItems: "stretch" }}>
          <SpendPaceCard series={paceSeries} currency={currency} />
          <CategoryDonutCard slices={slicesFor(range)} currency={currency} range={range} />
        </div>

        {/* Cash flow (daily) + cashflow calendar */}
        <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 12, alignItems: "stretch" }}>
          <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Cash Flow</div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6, marginTop: 2 }}>{monthLabel}</div>
              </div>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.muted, opacity: 0.75 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: HOME_THEME.green }} /> In
                <span style={{ width: 8, height: 8, borderRadius: 2, background: SOFT_RED, marginLeft: 8 }} /> Out
              </span>
            </div>
            <CashFlowBars buckets={cashflow} currency={currency} beginningBalance={computed.anyBeginning ? computed.beginningBalance : 0} />
          </div>

          <div style={{ ...card(), padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                {rightTab === "calendar" ? "Cashflow Calendar" : "Balance Projection"}
              </div>
              <Segmented
                value={rightTab}
                onChange={(v) => setRightTab(v as "calendar" | "projection")}
                options={[{ value: "calendar", label: "Calendar" }, { value: "projection", label: "Projection" }]}
              />
            </div>
            {rightTab === "calendar" ? (
              <CalendarGrid month={month} groups={computed.groups} currency={currency} selected={selectedDate} onSelect={setSelectedDate} mode={range} yearNet={yearNet} year={year} />
            ) : (
              <ProjectionChart series={computed.series} currency={currency} />
            )}
          </div>
        </div>

        {/* Alerts · banks · upcoming pay */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <RentCountdown info={rentInfo} currency={currency} />
          <BankAccountsCard value={dailyBalance} currency={currency} onSave={saveDailyBalance} fallback={bankNow} />
          <UpcomingPayCard data={upcomingPay} pastDue={billsDue.filter((b) => b.days < 0)} currency={currency} onMarkPaid={markBillPaid} />
        </div>

        {/* Recent transactions · category spend */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
          <RecentTransactions rows={recentPaid} currency={currency} categories={categories} />
          <CategorySpendCard
            categories={categories}
            spent={spendWindow[range].byCat}
            unsortedCount={spendWindow[range].unsortedCount}
            unsortedTotal={spendWindow[range].unsorted}
            currency={currency}
            onOpenCategories={() => setTab("categories")}
            range={range}
            budgetScale={range === "yearly" ? 12 : range === "monthly" ? 1 : range === "weekly" ? 7 / intel.daysInMonth : 1 / intel.daysInMonth}
          />
        </div>
        </>
        )}
        {tab === "register" && (
          <div style={{ ...cardAccent(2), flex: 1, minHeight: 0, overflow: "visible", padding: 0 }}>
            <MonthlyRegister
              groups={computed.groups}
              beginningBalance={computed.anyBeginning ? computed.beginningBalance : null}
              currency={currency}
              selectedDate={selectedDate}
              onEdit={editRow}
              onDelete={deleteRow}
              onMaterialize={materializeRecurring}
            />
          </div>
        )}
        {/* ── REAL MONTH ───────────────────────────────────────────────────
            What actually cleared, read off a statement into budget_statement_tx.
            Its own store — Overview and Payments never read it, so nothing
            double-counts. The only crossover is the per-subscription
            "→ Payments" button, which adds ONE monthly recurring rule. */}
        {tab === "real" && (
          <RealMonth
            month={month}
            onMonth={setMonth}
            categories={categories}
            currency={currency}
            defaultBank="secu"
            onOpenCategories={() => setTab("categories")}
            onCategoriesChanged={() => refresh(month)}
          />
        )}
        {/* Budget vs actual sits ABOVE the category editor, because the
            question "what should this budget be" is answered by the twelve
            months of actuals next to it — and the same block is on Real Month
            > Categories, rendered from the same component so the two can never
            drift. This copy fetches its own statement history; the editor
            below only knows about the plan. */}
        {tab === "categories" && (
          <CategoryBudgetSection
            month={month}
            categories={categories}
            currency={currency}
            onCategoriesChanged={() => refresh(month)}
          />
        )}
        {tab === "categories" && (
          <CategoriesPanel
            categories={categories}
            spent={categoryStats.spent}
            unsorted={categoryStats.unsorted}
            unsortedTotal={categoryStats.unsortedTotal}
            byCategory={categoryStats.byCategory}
            currency={currency}
            onAdd={addCategory}
            onDelete={deleteCategory}
            onColor={updateCategoryColor}
            onAssign={assignCategory}
            onDeleteRow={deleteRow}
          />
        )}
        {tab === "amazon" && (
          <div style={{ ...cardAccent(2), flex: 1, minHeight: 0, overflow: "visible", padding: 0 }}>
            <AmazonTable rows={amazonComputed.rows} currency={currency} onDelete={deleteAz} />
          </div>
        )}
        {tab === "bzila" && (
          <BzilaPanel data={bzilaComputed} year={Number(month.slice(0, 4))} currency={currency} onDelete={deleteProp} onOpenPayments={() => setTab("register")} />
        )}
        {tab === "yearly" && (
          <YearlyPanel data={yearMonths} categories={categories} year={year} onYear={setYear} currency={currency} loading={yearLoading} />
        )}

        {/* Composer */}
        {tab === "register" && (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "140px 1fr 130px 120px 130px 110px", gap: 10, alignItems: "center", position: "relative", zIndex: 20 }}>
            <input type="date" value={rwDate} onChange={(e) => setRwDate(e.target.value)} style={field()} />
            <input value={rwLabel} onChange={(e) => setRwLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()} placeholder="Item (RENT, H PAY, VENMO…)" style={field()} />
            <ThemedSelect value={rwBank} onChange={(v) => setRwBank(v as Bank)} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} />
            <ThemedSelect value={rwSign} onChange={(v) => setRwSign(v as "-" | "+")} options={[{ value: "-", label: "− Pay" }, { value: "+", label: "+ Income" }]} />
            <input value={rwAmount} onChange={(e) => setRwAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()} placeholder="Amount" type="number" style={field()} />
            <button onClick={addRow} style={primary()}>Add Row</button>
          </div>
        )}
        {tab === "amazon" && (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "150px 1fr 1fr 110px", gap: 10, alignItems: "center" }}>
            <input type="date" value={azDate} onChange={(e) => setAzDate(e.target.value)} style={field()} />
            <input value={azPay} onChange={(e) => setAzPay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveAmazon()} placeholder="Pay" type="number" style={field()} />
            <input value={azGas} onChange={(e) => setAzGas(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveAmazon()} placeholder="Gas" type="number" style={field()} />
            <button onClick={saveAmazon} style={primary()}>Add Day</button>
          </div>
        )}
        {tab === "bzila" && (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "140px 120px 120px 1fr 100px 120px 100px", gap: 10, alignItems: "center" }}>
            {ppSource === "cbedge" ? (
              <input type="month" value={ppDate.slice(0, 7)} onChange={(e) => setPpDate(e.target.value ? `${e.target.value}-01` : "")} title="CB Edge is tracked by month" style={field()} />
            ) : (
              <input type="date" value={ppDate} onChange={(e) => setPpDate(e.target.value)} style={field()} />
            )}
            <ThemedSelect
              value={ppSource}
              onChange={(v) => { setPpSource(v as PropSource); setPpFirm(PROP_SOURCE_UI[v as PropSource].defaultFirm); if (v === "cbedge") setPpDate((d) => `${d.slice(0, 7)}-01`); }}
              options={(Object.keys(PROP_SOURCE_UI) as PropSource[]).map((s) => ({ value: s, label: PROP_SOURCE_UI[s].label }))}
            />
            <ThemedSelect
              value={ppKind}
              onChange={(v) => setPpKind(v as "cost" | "payout")}
              options={[
                { value: "cost", label: PROP_SOURCE_UI[ppSource].costLabel },
                { value: "payout", label: PROP_SOURCE_UI[ppSource].payoutLabel },
              ]}
            />
            <input value={ppFirm} onChange={(e) => setPpFirm(e.target.value)} placeholder={PROP_SOURCE_UI[ppSource].firmPlaceholder} style={field()} />
            <input value={ppAccounts} onChange={(e) => setPpAccounts(e.target.value)} placeholder="Accts" type="number" disabled={ppSource !== "prop" || ppKind === "payout"} style={{ ...field(), opacity: ppSource !== "prop" || ppKind === "payout" ? 0.4 : 1 }} />
            <input value={ppCost} onChange={(e) => setPpCost(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProp()} placeholder={ppKind === "payout" ? "Amount in $" : "Amount out $"} type="number" style={field()} />
            <button onClick={addProp} style={primary()}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}

type ComputedRow = { id: number; entry_date: string; label: string; bank: Bank; amount: number; is_beginning: number; recurring: boolean; recurTag?: string; balance: number; balances: Record<Bank, number>; total: number };

function RecurringManager({
  rules,
  currency,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: {
  rules: RecurringRule[];
  currency: string;
  onAdd: (rule: { label: string; bank: Bank; amount: number; frequency: Frequency; anchorDate: string }) => void;
  onUpdate: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [bank, setBank] = useState<Bank>("secu");
  const [sign, setSign] = useState<"-" | "+">("-");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [anchor, setAnchor] = useState(todayIso());

  const add = () => {
    if (!label.trim() || amount.trim() === "") return;
    const signed = (sign === "-" ? -1 : 1) * Math.abs(Number(amount));
    onAdd({ label: label.trim().toUpperCase(), bank, amount: signed, frequency, anchorDate: anchor });
    setLabel("");
    setAmount("");
  };

  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 900 }}>Recurring entries</div>
          <div style={{ fontSize: 14, color: HOME_THEME.muted, marginTop: 3 }}>Anything that repeats — they appear on every month&apos;s Payments automatically.</div>
        </div>
        <button onClick={onClose} style={ghost()}>Done</button>
      </div>

      {/* Existing rules */}
      {rules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule) => {
            const inc = rule.amount > 0;
            return (
              <div key={rule.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.9fr 1fr auto auto", gap: 10, alignItems: "center", background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, padding: "8px 12px", opacity: rule.active ? 1 : 0.45 }}>
                <span style={{ fontWeight: 800 }}>{rule.label}</span>
                <span style={{ fontSize: 14, color: HOME_THEME.muted }}>{FREQ_LABEL[rule.frequency]}</span>
                <span style={{ fontSize: 14, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{BANK_LABEL[rule.bank]}</span>
                <span style={{ fontWeight: 800, color: inc ? HOME_THEME.green : SOFT_RED }}>{inc ? "+" : ""}{fmtMoney(rule.amount, currency)}</span>
                <button
                  onClick={() => onUpdate(rule.id, { active: rule.active ? 0 : 1 })}
                  title={rule.active ? "Pause (hide from Payments)" : "Resume"}
                  style={{ ...ghost(), padding: "6px 10px", fontSize: 14 }}
                >
                  {rule.active ? "Pause" : "Resume"}
                </button>
                <DeleteButton onClick={() => onDelete(rule.id)} />
              </div>
            );
          })}
        </div>
      )}

      {/* Add a new rule */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr 0.9fr 1fr 90px", gap: 10, alignItems: "end", borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 12 }}>
        <div><div style={labelCap()}>Item</div><input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="RENT, H PAY…" style={field()} /></div>
        <div><div style={labelCap()}>How often</div><ThemedSelect value={frequency} onChange={(v) => setFrequency(v as Frequency)} options={FREQS.map((f) => ({ value: f, label: FREQ_LABEL[f] }))} /></div>
        <div><div style={labelCap()}>Bank</div><ThemedSelect value={bank} onChange={(v) => setBank(v as Bank)} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} /></div>
        <div><div style={labelCap()}>Type</div><ThemedSelect value={sign} onChange={(v) => setSign(v as "-" | "+")} options={[{ value: "-", label: "− Pay" }, { value: "+", label: "+ Income" }]} /></div>
        <div><div style={labelCap()}>{frequency === "monthly" ? "Day (from date)" : "Start date"}</div><input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} style={field()} /></div>
        <div><div style={labelCap()}>Amount</div><input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="0" type="number" style={field()} /></div>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={add} style={primary()}>Add recurring</button>
        </div>
      </div>
    </div>
  );
}

type DayGroup = { date: string; rows: ComputedRow[]; dailyNet: number; eod: number };

// Catmull-Rom → cubic-bezier smoothing for a set of [x,y] points. `t` controls
// curviness (0 = straight polyline, ~0.2 = gentle, higher = loopier).
function smoothPath(pts: [number, number][], t = 0.2): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// Cashflow calendar. Three shapes behind one control:
//   Daily / Monthly → the month grid (Daily just pins the highlight on today)
//   Weekly          → a 7-day strip for the week containing today
//   Yearly          → twelve mini-months, each day tinted by its net
// Day tiles are a FIXED pixel size so every cell is identical no matter how
// wide the window (or the card) gets. The grid is centred and the wrapper
// scrolls horizontally on very narrow viewports instead of squashing cells.
const CELL_W = 104, CELL_H = 78;

function DayCell({ d, iso, g, currency, isSel, isToday, onSelect, w = CELL_W, h = CELL_H }: {
  d: number; iso: string; g: DayGroup | undefined; currency: string; isSel: boolean; isToday: boolean;
  onSelect: (date: string) => void; w?: number; h?: number;
}) {
  const net = g?.dailyNet ?? 0;
  const pos = net > 0, neg = net < 0;
  const tint = neg ? "rgba(244,148,142,0.10)" : pos ? "rgba(142,202,230,0.08)" : "rgba(255,255,255,0.02)";
  return (
    <button
      onClick={() => g && onSelect(iso)}
      disabled={!g}
      style={{
        textAlign: "left", width: w, height: h, boxSizing: "border-box", padding: "6px 7px", borderRadius: 9,
        cursor: g ? "pointer" : "default", overflow: "hidden", background: tint,
        border: `1px solid ${isSel ? "#7dd3fc" : isToday ? "rgba(255,255,255,0.6)" : g ? HOME_THEME.border : "transparent"}`,
        boxShadow: isSel ? "0 0 0 1px rgba(126,211,252,0.4)" : isToday ? "0 0 0 1px rgba(255,255,255,0.25)" : "none",
        color: HOME_THEME.text, transition: "all 0.12s ease",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.muted, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{d}</span>
      </div>
      {g && <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: neg ? SOFT_RED : pos ? HOME_THEME.green : HOME_THEME.muted }}>{pos ? "+" : ""}{fmtMoney(net, currency)}</div>}
    </button>
  );
}

/**
 * A small pill toggle for switching one card between two views.
 * Ported back from the Next owner route along with ProjectionChart.
 */
function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ display: "inline-flex", padding: 3, borderRadius: 10, background: "rgba(0,0,0,0.35)", border: `1px solid ${HOME_THEME.border}` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.06em",
              background: on ? bRgba(HOME_THEME.cyan, 0.18) : "transparent",
              color: on ? HOME_THEME.cyan : HOME_THEME.muted,
              opacity: on ? 1 : 0.6,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Balance Projection — the running combined balance across the month, with a
 * hover guide and a tooltip carrying the exact date and balance.
 *
 * The calendar answers "what happens on the 14th". This answers the question
 * the calendar cannot: "does the balance ever go negative before payday", which
 * is a shape, not a cell.
 */
function ProjectionChart({ series, currency }: { series: { date: string; balance: number }[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) {
    return <div style={{ height: 240, display: "grid", placeItems: "center", color: HOME_THEME.muted, fontSize: 14 }}>Add entries to see the projection.</div>;
  }
  const W = 560, H = 240, padL = 4, padR = 4, padT = 8, padB = 18;
  const ys = series.map((p) => p.balance);
  const maxY = Math.max(...ys, 0);
  const minY = Math.min(...ys, 0);
  const span = Math.max(maxY - minY, 1);
  const x = (i: number) => padL + (i / (series.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - minY) / span) * (H - padT - padB);
  const zeroY = y(0);
  const path = smoothPath(series.map((p, i) => [x(i), y(p.balance)] as [number, number]), 0.22);
  const ticks = series.filter((_, i) => i % Math.ceil(series.length / 8) === 0);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (series.length - 1)));
  };
  const hp = hover !== null ? series[hover] : null;
  const hx = hover !== null ? (hover / (series.length - 1)) * 100 : 0;

  return (
    <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id="projAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LIGHT_BLUE} stopOpacity={0.32} />
            <stop offset="100%" stopColor={LIGHT_BLUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 5" />
        <path d={`${path} L ${x(series.length - 1).toFixed(1)} ${H - padB} L ${x(0).toFixed(1)} ${H - padB} Z`} fill="url(#projAreaFill)" stroke="none" />
        {/* soft under-stroke = neon glow without an SVG filter */}
        <path d={path} fill="none" stroke={bRgba(LIGHT_BLUE, 0.45)} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path} fill="none" stroke={LIGHT_BLUE} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {hp && <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.28)" strokeWidth={1} />}
        {hp && <circle cx={x(hover!)} cy={y(hp.balance)} r={3.5} fill={LIGHT_BLUE} stroke={INK} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {ticks.map((p, i) => (
          <text key={i} x={x(series.indexOf(p))} y={H - 4} fill={HOME_THEME.muted} fontSize={11} textAnchor="middle">{shortDate(p.date)}</text>
        ))}
      </svg>
      {hp && (
        <div style={{ position: "absolute", top: 0, left: `${hx}%`, transform: `translateX(${hx > 60 ? "-108%" : "8px"})`, pointerEvents: "none", background: "rgba(5,8,14,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${bRgba(LIGHT_BLUE, 0.22)}`, borderRadius: 8, padding: "6px 10px", whiteSpace: "nowrap", boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: HOME_THEME.muted }}>{shortDate(hp.date)}</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: hp.balance < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(hp.balance, currency)}</div>
        </div>
      )}
    </div>
  );
}

const WD = ["S", "M", "T", "W", "T", "F", "S"];

function CalendarGrid({
  month,
  groups,
  currency,
  selected,
  onSelect,
  mode,
  yearNet,
  year,
}: {
  month: string;
  groups: DayGroup[];
  currency: string;
  selected: string | null;
  onSelect: (date: string) => void;
  mode: RangeMode;
  /** iso → net, for the whole year. Powers the yearly heatmap. */
  yearNet: Map<string, number>;
  year: number;
}) {
  const byDate = new Map(groups.map((g) => [g.date, g]));
  const todayStr = todayIso();

  // ── Weekly: the seven days of the week containing today ───────────────────
  if (mode === "weekly") {
    const now = new Date(todayStr + "T00:00:00");
    const sunday = addDays(todayStr, -now.getDay());
    const days = Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
    return (
      <div style={{ width: "100%", overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL_W}px)`, gap: 5, flex: "none" }}>
          {WD.map((w, i) => (
            <div key={i} style={{ width: CELL_W, boxSizing: "border-box", textAlign: "center", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.muted, padding: "2px 0 4px" }}>{w}</div>
          ))}
          {days.map((iso) => (
            <DayCell
              key={iso}
              d={Number(iso.slice(8, 10))}
              iso={iso}
              g={byDate.get(iso)}
              currency={currency}
              isSel={selected === iso}
              isToday={iso === todayStr}
              onSelect={onSelect}
              h={CELL_H + 14}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Yearly: twelve mini-months, one dot per day tinted by net ─────────────
  if (mode === "yearly") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 10 }}>
        {Array.from({ length: 12 }, (_, mi) => {
          const ym = `${year}-${String(mi + 1).padStart(2, "0")}`;
          const dim = new Date(year, mi + 1, 0).getDate();
          const lead = new Date(year, mi, 1).getDay();
          return (
            <div key={ym} style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, padding: "7px 8px 9px", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.muted, marginBottom: 6 }}>
                {new Date(year, mi, 1).toLocaleDateString("en-US", { month: "short" })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                {Array.from({ length: lead }, (_, i) => <div key={`p${i}`} style={{ aspectRatio: "1 / 1" }} />)}
                {Array.from({ length: dim }, (_, i) => {
                  const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
                  const net = yearNet.get(iso);
                  const has = net !== undefined && net !== 0;
                  const neg = (net ?? 0) < 0;
                  return (
                    <button
                      key={iso}
                      title={has ? `${iso} · ${fmtMoney(net as number, currency)}` : iso}
                      onClick={() => onSelect(iso)}
                      style={{
                        aspectRatio: "1 / 1", borderRadius: 3, padding: 0, cursor: "pointer",
                        border: iso === todayStr ? "1px solid rgba(255,255,255,0.7)" : selected === iso ? "1px solid #7dd3fc" : "1px solid transparent",
                        background: has ? (neg ? bRgba(SOFT_RED, 0.75) : bRgba(HOME_THEME.green, 0.75)) : "rgba(255,255,255,0.06)",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: HOME_THEME.muted, opacity: 0.7, marginTop: 2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: bRgba(HOME_THEME.green, 0.75) }} />Up on the day</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: bRgba(SOFT_RED, 0.75) }} />Down on the day</span>
          <span style={{ opacity: 0.7 }}>Logged rows only</span>
        </div>
      </div>
    );
  }

  // ── Daily / Monthly: the month grid ───────────────────────────────────────
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Sun
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const todayDay = todayStr.slice(0, 7) === month ? Number(todayStr.slice(8, 10)) : null;
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  return (
    <div style={{ width: "100%", overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL_W}px)`, gap: 5, flex: "none" }}>
        {WD.map((w, i) => (
          <div key={i} style={{ width: CELL_W, boxSizing: "border-box", textAlign: "center", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.muted, padding: "2px 0 4px" }}>{w}</div>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <div key={`e${i}`} style={{ width: CELL_W, height: CELL_H, boxSizing: "border-box" }} />
          ) : (
            <DayCell
              key={d}
              d={d}
              iso={iso(d)}
              g={byDate.get(iso(d))}
              currency={currency}
              isSel={selected === iso(d)}
              isToday={d === todayDay}
              onSelect={onSelect}
            />
          )
        )}
      </div>
    </div>
  );
}

// The whole month's running transaction list, always visible below the
// calendar. Every day is shown (header: net + EOD) with its rows and the single
// running balance carried down. The day picked in the calendar is highlighted
// and scrolled into view; inline edit + delete work per row.
function MonthlyRegister({
  groups,
  beginningBalance,
  currency,
  selectedDate,
  onEdit,
  onDelete,
  onMaterialize,
}: {
  groups: DayGroup[];
  beginningBalance: number | null;
  currency: string;
  selectedDate: string | null;
  onEdit: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  onMaterialize: (row: ComputedRow) => void;
}) {
  const selRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedDate && selRef.current) {
      selRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedDate]);

  const longDate = (isoStr: string) => {
    const [yy, mm, dd] = isoStr.split("-").map(Number);
    return new Date(yy, mm - 1, dd).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" });
  };
  if (!groups.length && beginningBalance === null) {
    return <div style={{ padding: "26px 16px", textAlign: "center", color: HOME_THEME.muted }}>Set your starting balances, then add rows below.</div>;
  }
  return (
    <div style={{ padding: 16 }}>
      {beginningBalance !== null && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "9px 12px", borderRadius: 10, background: "rgba(126,211,252,0.06)", border: `1px solid ${HOME_THEME.border}` }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", color: "#7dd3fc" }}>STARTING BALANCE</span>
          <span style={{ fontWeight: 900, fontSize: 17, color: beginningBalance < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(beginningBalance, currency)}</span>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((g) => {
          const isSel = selectedDate === g.date;
          return (
            <div
              key={g.date}
              ref={isSel ? selRef : undefined}
              style={{ borderRadius: 12, border: `1px solid ${isSel ? "#7dd3fc" : HOME_THEME.border}`, boxShadow: isSel ? "0 0 0 1px rgba(126,211,252,0.35)" : "none", overflow: "hidden" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.04)" }}>
                <span style={{ fontWeight: 900, fontSize: 17 }}>{longDate(g.date)}</span>
              </div>
              {g.rows.map((r) => {
                const isIncome = r.amount > 0;
                // Paid = a real logged row; recurring occurrences are still owed,
                // or past due once their date has passed without being logged.
                const status: "paid" | "owed" | "pastdue" | null = r.amount < 0 ? (r.recurring ? (r.entry_date < todayIso() ? "pastdue" : "owed") : "paid") : null;
                return (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center", padding: "8px 12px", borderTop: `1px solid rgba(255,255,255,0.04)` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      {r.recurring ? (
                        <span style={{ fontWeight: 700, fontStyle: "italic" }}>🔁 {r.label}</span>
                      ) : (
                        <>
                          <EditableDate value={r.entry_date} onCommit={(v) => onEdit(r.id, { date: v })} />
                          <EditableText value={r.label} onCommit={(v) => onEdit(r.id, { label: v.toUpperCase() })} style={{ fontWeight: 700 }} />
                        </>
                      )}
                      {status && <StatusPill status={status} />}
                    </div>
                    <span style={{ fontWeight: 800, textAlign: "right", minWidth: 90, color: isIncome ? HOME_THEME.green : r.amount < 0 ? SOFT_RED : HOME_THEME.text }}>
                      {r.recurring ? fmtMoney(r.amount, currency) : <EditableMoney value={r.amount} onCommit={(v) => onEdit(r.id, { amount: v })} />}
                    </span>
                    <span style={{ textAlign: "right", minWidth: 100, fontWeight: 800, color: r.balance < 0 ? SOFT_RED : HOME_THEME.muted }}>{fmtMoney(r.balance, currency)}</span>
                    <span style={{ width: 30, textAlign: "center" }}>
                      {r.recurring
                        ? <EditButton title="Recurring entry — click to edit just this occurrence (amount changed or paid early)" onClick={() => onMaterialize(r)} />
                        : <DeleteButton onClick={() => onDelete(r.id)} />}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Payment status chip: real logged rows are Paid; recurring occurrences are
// Owed (upcoming) or Past due (their date has passed and they're still unlogged).
function StatusPill({ status }: { status: "paid" | "owed" | "pastdue" }) {
  const map = {
    paid: { label: "Paid", color: HOME_THEME.green, bg: "rgba(142,202,230,0.12)", border: "rgba(142,202,230,0.35)" },
    owed: { label: "Owed", color: HOME_THEME.cyan, bg: "rgba(126,211,252,0.10)", border: "rgba(126,211,252,0.35)" },
    pastdue: { label: "Past due", color: SOFT_RED, bg: "rgba(244,148,142,0.14)", border: "rgba(244,148,142,0.4)" },
  }[status];
  return (
    <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: map.color, background: map.bg, border: `1px solid ${map.border}`, padding: "2px 8px", borderRadius: 999 }}>
      {map.label}
    </span>
  );
}

// Clear, always-visible red delete control used in both tables.
function DeleteButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Remove this row"
      aria-label="Remove this row"
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        border: `1px solid ${hover ? SOFT_RED : "rgba(239,68,68,0.30)"}`,
        background: hover ? "rgba(239,68,68,0.16)" : "rgba(239,68,68,0.07)",
        color: SOFT_RED,
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.12s ease",
      }}
    >
      ×
    </button>
  );
}

// Pencil control on a recurring occurrence — materializes it into a real row
// that can then be edited (amount, label, date) or deleted on its own.
function EditButton({ onClick, title }: { onClick: () => void; title?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title ?? "Edit this entry"}
      aria-label="Edit this entry"
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        border: `1px solid ${hover ? HOME_THEME.cyan : HOME_THEME.border}`,
        background: hover ? "rgba(33,158,188,0.16)" : "rgba(33,158,188,0.07)",
        color: HOME_THEME.cyan,
        cursor: "pointer",
        fontSize: 17,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.12s ease",
      }}
    >
      ✎
    </button>
  );
}

// Inline-editable date (click the M-D chip to change a row's date, e.g. a bill
// paid early). Commits an entry_date change through onEdit.
function EditableDate({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft && draft !== value) onCommit(draft); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        style={{ ...field(), padding: "4px 8px", width: 160 }}
      />
    );
  }
  return (
    <span onClick={() => setEditing(true)} title="Change date (e.g. paid early)" style={{ cursor: "text", fontSize: 14, fontWeight: 700, color: HOME_THEME.muted, borderBottom: "1px dotted rgba(139,148,167,0.35)", whiteSpace: "nowrap" }}>
      {shortDate(value)}
    </span>
  );
}

// ── Overview building blocks ─────────────────────────────────────────────────

/** Top-row metric tile. `hero` inverts it (the All Banks card). */
function StatTile({ label, value, sub, valueColor, hero, delta, currency }: { label: string; value: string; sub?: string; valueColor?: string; hero?: boolean; delta?: number | null; currency?: string }) {
  return (
    <div
      style={{
        ...card(),
        padding: 16,
        ...(hero
          ? {
              background: "#000000",
              border: `1px solid ${bRgba(LIGHT_BLUE, 0.60)}`,
              boxShadow: `${EDGE_LIGHT}, 0 0 36px -6px ${bRgba(LIGHT_BLUE, 0.55)}, 0 24px 60px -16px rgba(0,0,0,0.75)`,
            }
          : null),
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", color: hero ? LIGHT_BLUE : (valueColor ?? HOME_THEME.text), textShadow: hero ? `0 0 30px ${bRgba(LIGHT_BLUE, 0.65)}` : "none" }}>{value}</div>
      {sub && <div style={{ marginTop: 4, fontSize: 12, color: HOME_THEME.muted, opacity: 0.55 }}>{sub}</div>}
      {delta != null && delta !== 0 && (
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: delta < 0 ? SOFT_RED : HOME_THEME.green }}>
          {delta > 0 ? "↗ +" : "↘ "}{fmtMoney(delta, currency || "USD").replace("-", "")} vs last
        </div>
      )}
    </div>
  );
}

/** Card header used by the intelligence row. */
function IntelHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>{title}</div>
      {right}
    </div>
  );
}

/**
 * Safe-to-Spend: what's left after every bill still due this month, expressed
 * at whatever cadence the tab asks for. There's no yearly reading — the pot is
 */
function SafeToSpendCard({ intel, currency, range }: { intel: Intel; currency: string; range: RangeMode }) {
  const rate = range === "monthly" || range === "yearly" ? intel.safe : range === "weekly" ? intel.safePerDay * 7 : intel.safePerDay;
  const unit = range === "monthly" || range === "yearly" ? "left this month" : range === "weekly" ? "/week" : "/day";
  const neg = rate < 0;
  const pct = Math.min(100, Math.max(0, (intel.todayDay / intel.daysInMonth) * 100));
  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader title="Safe to Spend" />
      <div style={{ fontSize: 34, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: neg ? SOFT_RED : LIGHT_BLUE, textShadow: `0 0 30px ${bRgba(neg ? SOFT_RED : LIGHT_BLUE, 0.6)}` }}>
        {fmtMoney(rate, currency)}<span style={{ fontSize: 14, fontWeight: 800, opacity: 0.7 }}> {unit}</span>
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ opacity: 0.6 }}>Free this month</span><b style={{ color: intel.safe < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(intel.safe, currency)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ opacity: 0.6 }}>Bills still due</span><b style={{ color: SOFT_RED }}>{fmtMoney(intel.billsLeft, currency)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ opacity: 0.6 }}>Days left</span><b>{intel.daysLeft}</b></div>
      </div>
      <div style={{ marginTop: "auto", paddingTop: 12 }}>
        <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${HOME_THEME.cyan}, ${LIGHT_BLUE})`, boxShadow: `0 0 12px ${bRgba(LIGHT_BLUE, 0.6)}` }} />
        </div>
        <div style={{ marginTop: 5, fontSize: 12, opacity: 0.55 }}>Day {Math.max(intel.todayDay, 0)} of {intel.daysInMonth}</div>
      </div>
    </div>
  );
}

/**
 * Spend Pace: cumulative spend for the selected month against TWO reference
 * ramps — the straight-line budget (what you intended) and a typical month
 * (what you actually do). The second one is the useful half: a budget that
 * was never once hit stops being information, while "ahead of a normal month
 * by $310 on the 14th" always is.
 *
 * Drawn in the /owner/charts-ui area-chart idiom: dashed grid, gradient fill
 * under a smooth curve, dashed pace lines, marker on the last real point.
 */
type PaceSeries = {
  cum: number[]; labels: string[]; budget: number;
  /** A typical month's TOTAL, and its day-by-day shape (null when there is no
      prior history, or at a resolution with no day axis). */
  avg: number; avgCum: number[] | null; avgN: number;
  upTo: number; span: number; scope: string;
};
function SpendPaceCard({ series, currency }: { series: PaceSeries; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 680, H = 250, PADL = 8, PADR = 8, PADT = 12, PADB = 26;
  const n = Math.max(series.span, 1);
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;

  const avgCum = series.avgCum;
  const maxV = Math.max(series.budget, series.avg, series.cum[series.cum.length - 1] || 0, 1);
  const px = (i: number) => (n === 1 ? PADL + plotW / 2 : PADL + (i / (n - 1)) * plotW);
  const py = (v: number) => PADT + plotH - (Math.min(v, maxV) / maxV) * plotH;

  const upTo = Math.max(0, Math.min(series.upTo, series.cum.length));
  const pts = series.cum.slice(0, upTo);
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L ${px(pts.length - 1).toFixed(1)} ${PADT + plotH} L ${px(0).toFixed(1)} ${PADT + plotH} Z` : "";
  const spent = pts.length ? pts[pts.length - 1] : 0;

  // The benchmark is the average month's own curve where we have one, and only
  // falls back to the straight budget ramp when there is no history to average.
  // Which one is driving the badge is stated on the badge, because "over by
  // $1,654" means two completely different things depending on the answer.
  const avgSoFar = avgCum && upTo > 0 ? avgCum[Math.min(upTo, avgCum.length) - 1] : null;
  const benchmark = avgSoFar ?? (series.budget * upTo) / n;
  const usingAvg = avgSoFar != null;
  const over = spent > benchmark;
  const delta = Math.abs(spent - benchmark);
  const accent = over ? SOFT_RED : LIGHT_BLUE;

  const avgPath = avgCum
    ? avgCum.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ")
    : "";

  // Sparse x labels — every label would collide at 31 days wide.
  const step = Math.max(1, Math.ceil(series.labels.length / 10));
  const hv = hover != null ? series.cum[hover] ?? 0 : 0;
  const ha = hover != null && avgCum ? avgCum[Math.min(hover, avgCum.length - 1)] : null;
  const hovered = hover != null && hover < upTo;

  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader title="Spend Pace" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: -6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6 }}>
          {series.scope}
          {hovered && <> · day {series.labels[hover!]} · <b style={{ color: HOME_THEME.text }}>{fmtMoney(hv, currency).replace(/\.\d+$/, "")}</b>
            {ha != null && <> vs <span style={{ color: HOME_THEME.gold }}>{fmtMoney(ha, currency).replace(/\.\d+$/, "")}</span></>}</>}
        </span>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 999, color: over ? SOFT_RED : HOME_THEME.green, background: bRgba(over ? SOFT_RED : HOME_THEME.green, 0.12), border: `1px solid ${bRgba(over ? SOFT_RED : HOME_THEME.green, 0.4)}`, boxShadow: `0 0 12px ${bRgba(over ? SOFT_RED : HOME_THEME.green, 0.25)}` }}>
          {over ? "OVER" : "UNDER"} {fmtMoney(delta, currency).replace(/\.\d+$/, "")} {usingAvg ? "vs avg" : "vs budget"}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" style={{ display: "block" }}>
        <defs>
          <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.42} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={PADL} x2={W - PADR} y1={PADT + g * plotH} y2={PADT + g * plotH} stroke={CHART.grid} strokeDasharray="4 4" />
        ))}

        {/* straight-line budget — kept, but demoted: it is what you intended,
            not what a month of yours actually looks like */}
        <line x1={px(0)} y1={py(series.budget / n)} x2={px(n - 1)} y2={py(series.budget)} stroke="rgba(255,255,255,0.20)" strokeDasharray="4 5" />

        {/* the average month's real shape — rent step and all */}
        {avgPath && <path d={avgPath} fill="none" stroke={bRgba(HOME_THEME.gold, 0.75)} strokeWidth={2} strokeDasharray="3 4" strokeLinejoin="round" strokeLinecap="round" />}

        {area && <path d={area} fill="url(#paceFill)" />}
        {line && <path d={line} fill="none" stroke={bRgba(accent, 0.45)} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />}
        {line && <path d={line} fill="none" stroke={accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {pts.length > 0 && <circle cx={px(pts.length - 1)} cy={py(spent)} r={4} fill={accent} stroke={INK} strokeWidth={1.5} />}

        {hovered && (
          <>
            <line x1={px(hover!)} x2={px(hover!)} y1={PADT} y2={PADT + plotH} stroke="rgba(255,255,255,0.28)" />
            <circle cx={px(hover!)} cy={py(hv)} r={4} fill={accent} stroke={INK} strokeWidth={1.5} />
            {ha != null && <circle cx={px(hover!)} cy={py(ha)} r={3.5} fill={HOME_THEME.gold} stroke={INK} strokeWidth={1.5} />}
          </>
        )}

        {/* per-point hit targets: exact, and immune to the viewBox scaling */}
        {series.labels.map((_, i) => (
          <rect
            key={i}
            x={px(i) - plotW / (2 * Math.max(n - 1, 1))} y={PADT}
            width={plotW / Math.max(n - 1, 1)} height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}

        <g fill={CHART.axis} fontSize={11} textAnchor="middle">
          {series.labels.map((l, i) => (i % step === 0 ? <text key={i} x={px(i)} y={H - 8}>{l}</text> : null))}
        </g>
      </svg>

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        <span style={{ opacity: 0.6, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 0, borderTop: `2px solid ${accent}`, display: "inline-block" }} />
          Spent <b style={{ color: HOME_THEME.text }}>{fmtMoney(spent, currency)}</b>
        </span>
        {series.avg > 0 && (
          <span style={{ opacity: 0.6, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 0, borderTop: `2px dotted ${bRgba(HOME_THEME.gold, 0.9)}`, display: "inline-block" }} />
            {avgCum ? "Typical month" : "Avg month"} <b style={{ color: HOME_THEME.text }}>{fmtMoney(series.avg, currency)}</b>
            <span style={{ opacity: 0.55 }}>({series.avgN} mo)</span>
          </span>
        )}
        <span style={{ opacity: 0.6, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 0, borderTop: "2px dashed rgba(255,255,255,0.35)", display: "inline-block" }} />
          Budget <b style={{ color: HOME_THEME.text }}>{fmtMoney(series.budget, currency)}</b>
        </span>
      </div>
    </div>
  );
}

/**
 * Where It Went — interactive pie, bklit-style.
 *
 * Hovering a wedge pushes it out of the ring and lights the matching legend
 * row; hovering a legend row does the same in reverse. The centre swaps from
 * the window total to the hovered slice. Pointer state is shared, so the two
 * halves always agree.
 */
function CategoryDonutCard({ slices, currency, range }: { slices: Intel["slices"]; currency: string; range: RangeMode }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const hasAvg = slices.some((x) => x.avg != null);
  const avgTotal = slices.reduce((s, x) => s + (x.avg ?? 0), 0);
  const CX = 60, CY = 60, R = 46, POP = 5;
  const DONUT_PX = 168;

  // Wedge path. `push` offsets the slice along its own mid-angle so the hovered
  // one lifts out of the pie instead of just changing colour.
  const wedge = (a0: number, a1: number, push: number) => {
    const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
    const mid = rad((a0 + a1) / 2);
    const ox = Math.cos(mid) * push, oy = Math.sin(mid) * push;
    const x0 = CX + ox + R * Math.cos(rad(a0)), y0 = CY + oy + R * Math.sin(rad(a0));
    const x1 = CX + ox + R * Math.cos(rad(a1)), y1 = CY + oy + R * Math.sin(rad(a1));
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${CX + ox} ${CY + oy} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
  };

  const active = hover !== null ? slices[hover] : null;
  let acc = 0;
  const arcs = slices.map((sl) => {
    const a0 = (acc / total) * 360;
    acc += sl.value;
    return { sl, a0, a1: (acc / total) * 360 };
  });

  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader title="Where It Went" />
      <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6, marginTop: -6, marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{RANGE_WINDOW_LABEL[range]}</span>
        {hasAvg && <span>vs a typical month</span>}
      </div>
      {total <= 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", opacity: 0.55, fontSize: 14, textAlign: "center" }}>No categorized spend {RANGE_WINDOW_LABEL[range].toLowerCase()}.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 0 }}>
          <div style={{ position: "relative", flex: "none" }}>
            <svg viewBox="0 0 120 120" width={DONUT_PX} height={DONUT_PX} onMouseLeave={() => setHover(null)} style={{ overflow: "visible" }}>
              {arcs.map(({ sl, a0, a1 }, i) => {
                const on = hover === i;
                const dim = hover !== null && !on;
                return (
                  <path
                    key={i}
                    d={wedge(a0, a1, on ? POP : 0)}
                    fill={sl.color}
                    stroke={INK}
                    strokeWidth={1.5}
                    opacity={dim ? 0.32 : 1}
                    onMouseEnter={() => setHover(i)}
                    style={{ cursor: "pointer", transition: "opacity .15s ease, d .15s ease", filter: on ? `drop-shadow(0 0 10px ${sl.color})` : "none" }}
                  />
                );
              })}
            </svg>
            {/* Centre readout floats over the pie so the wedges stay solid. */}
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 900, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums", textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
                  {fmtMoney(active ? active.value : total, currency).replace(/\.\d+$/, "")}
                </div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(255,255,255,0.65)", textTransform: "uppercase", maxWidth: 104, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
                  {active ? active.label : "Spent"}
                </div>
                {hasAvg && (
                  <div style={{ fontSize: 9, fontWeight: 700, marginTop: 2, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap", textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
                    usually {fmtMoney(active ? active.avg ?? 0 : avgTotal, currency).replace(/\.\d+$/, "")}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2, fontSize: 12, fontVariantNumeric: "tabular-nums" }} onMouseLeave={() => setHover(null)}>
            {slices.slice(0, 8).map((sl, i) => {
              const on = hover === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "3px 6px", borderRadius: 7, cursor: "pointer",
                    background: on ? "rgba(255,255,255,0.07)" : "transparent",
                    opacity: hover !== null && !on ? 0.45 : 1,
                    transition: "background .15s ease, opacity .15s ease",
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: sl.color, boxShadow: `0 0 8px ${sl.color}`, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: on ? 800 : 600, color: on ? HOME_THEME.text : "rgba(255,255,255,0.8)" }}>{sl.label}</span>
                  <b style={{ width: 76, textAlign: "right", flex: "none", color: on ? HOME_THEME.text : "rgba(255,255,255,0.55)" }}>{fmtMoney(sl.value, currency).replace(/\.\d+$/, "")}</b>
                  <span style={{ width: 40, textAlign: "right", flex: "none", opacity: 0.5 }}>{Math.round((sl.value / total) * 100)}%</span>
                  {hasAvg && (() => {
                    const avg = sl.avg ?? 0;
                    // A category with no history has nothing to be over or
                    // under, and printing "+100%" for its first month would be
                    // noise dressed as a signal.
                    if (avg <= 0) return <span style={{ width: 96, textAlign: "right", flex: "none", opacity: 0.3 }}>new</span>;
                    const d = sl.value - avg;
                    const pct = Math.round((d / avg) * 100);
                    return (
                      <span style={{ width: 96, textAlign: "right", flex: "none", color: d > 0 ? SOFT_RED : HOME_THEME.green, opacity: on ? 1 : 0.75 }}
                        title={`Typical month: ${fmtMoney(avg, currency)}`}>
                        {d > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(d), currency).replace(/\.\d+$/, "")}
                        <span style={{ opacity: 0.6 }}> {Math.abs(pct)}%</span>
                      </span>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Balance Check (weekly): reconciles the last two manually-entered bank balances.
 * Only counts CLEARED money (bills you've hit Pay on); upcoming/past-due bills
 * are shown separately as "not yet paid" so they never throw the number off.
 */
type Reconcile = {
  from: string; to: string; days: number; prevBalance: number;
  moneyIn: number; moneyOut: number; uncleared: number; expected: number; actual: number; drift: number;
};
function BalanceCheckCard({ data, currency }: { data: Reconcile | null; currency: string }) {
  if (!data) {
    return (
      <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
        <IntelHeader title="Weekly Balance Check" />
        <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", gap: 6, color: HOME_THEME.muted, opacity: 0.7, fontSize: 13, minHeight: 120 }}>
          <div style={{ fontSize: 26 }}>⚖️</div>
          <div>Log a bank balance about a week apart and this card flags any gap between what should have left the account and what actually did.</div>
        </div>
      </div>
    );
  }
  const off = Math.abs(data.drift) >= 1; // ignore sub-dollar rounding
  // Colour follows the DIRECTION of the money, not whether it reconciles:
  // up (or flat) = green, down = red.
  const flagColor = data.drift >= 0 ? HOME_THEME.green : SOFT_RED;
  const fmtDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const Row = ({ label, value, color, sign, strong, top }: { label: string; value: number; color?: string; sign?: boolean; strong?: boolean; top?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontVariantNumeric: "tabular-nums", padding: "5px 0", borderTop: top ? `1px solid ${HAIRLINE}` : undefined }}>
      <span style={{ opacity: 0.7, fontWeight: strong ? 800 : 600 }}>{label}</span>
      <span style={{ fontWeight: strong ? 900 : 700, color: color || HOME_THEME.text }}>
        {sign ? (value >= 0 ? "+" : "−") : ""}{fmtMoney(sign ? Math.abs(value) : value, currency)}
      </span>
    </div>
  );
  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader
        title="Weekly Balance Check"
        right={
          <span style={{ fontSize: 12, fontWeight: 900, padding: "3px 10px", borderRadius: 999, color: flagColor, background: bRgba(flagColor, 0.12), border: `1px solid ${bRgba(flagColor, 0.4)}` }}>
            {off ? "⚑ Off" : "✓ Reconciles"}
          </span>
        }
      />
      <div style={{ fontSize: 30, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: flagColor, textShadow: `0 0 26px ${bRgba(flagColor, 0.5)}` }}>
        {data.drift >= 0 ? "+" : "−"}{fmtMoney(Math.abs(data.drift), currency)}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, marginTop: 2 }}>
        {off ? `unaccounted over ${data.days} day${data.days === 1 ? "" : "s"}` : `matches over ${data.days} day${data.days === 1 ? "" : "s"}`} · {fmtDay(data.from)} → {fmtDay(data.to)}
      </div>
      <div style={{ marginTop: 10, flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <Row label={`Balance ${fmtDay(data.from)}`} value={data.prevBalance} />
        <Row label="Money in" value={data.moneyIn} color={HOME_THEME.green} sign />
        <Row label="Money out" value={-data.moneyOut} color={SOFT_RED} sign />
        <Row label="Expected now" value={data.expected} strong top />
        <Row label={`Actual now (${fmtDay(data.to)})`} value={data.actual} strong />
        <Row label="Difference" value={data.drift} color={flagColor} strong sign top />
        {data.uncleared > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontVariantNumeric: "tabular-nums", opacity: 0.55, paddingTop: 4 }}>
            <span>Not yet paid (still in bank)</span>
            <span>{fmtMoney(data.uncleared, currency)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Grouped in/out bar chart for the cash-flow card. */
function CashFlowBars({ buckets, currency, beginningBalance = 0 }: { buckets: { label: string; inflow: number; outflow: number }[]; currency: string; beginningBalance?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!buckets.length) {
    return <div style={{ height: 260, display: "grid", placeItems: "center", color: HOME_THEME.muted, opacity: 0.6, fontSize: 14 }}>No cash flow this period yet.</div>;
  }
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.inflow, b.outflow)));
  const H = 240;
  const grid = [0, 0.5, 1];

  // Running balance is still computed for the hover tooltip, but it is no longer
  // drawn as a line/axis on the chart — the bars alone carry the story.
  let run = beginningBalance;
  const balances = buckets.map((b) => (run += b.inflow - b.outflow));

  return (
    <div style={{ position: "relative", display: "flex", gap: 10 }}>
      {/* y axis */}
      <div style={{ width: 52, height: H, position: "relative", flex: "none" }}>
        {grid.map((g) => (
          <div key={g} style={{ position: "absolute", right: 6, top: (1 - g) * H - 7, fontSize: 12, color: HOME_THEME.muted, opacity: 0.5 }}>
            {g === 0 ? "0" : fmtMoney(max * g, currency).replace(/\.\d+$/, "")}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: "relative", height: H }}>
          {grid.map((g) => (
            <div key={g} style={{ position: "absolute", left: 0, right: 0, top: (1 - g) * H, borderTop: `1px dashed ${HOME_THEME.border}` }} />
          ))}
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: buckets.length > 20 ? 2 : 8 }}>
              {buckets.map((b, i) => (
                <div
                  key={`${b.label}-${i}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative", background: hover === i ? "rgba(255,255,255,0.03)" : "transparent", borderRadius: 6 }}
                >
                  <div style={{ flex: 1, maxWidth: 18, height: `${(b.inflow / max) * 100}%`, minHeight: b.inflow > 0 ? 2 : 0, background: `linear-gradient(180deg, ${HOME_THEME.green} 0%, ${bRgba(HOME_THEME.green, 0.45)} 100%)`, borderRadius: "4px 4px 0 0", boxShadow: hover === i ? `0 0 16px ${bRgba(HOME_THEME.green, 0.6)}` : `0 0 8px ${bRgba(HOME_THEME.green, 0.18)}`, transition: "box-shadow .15s ease" }} />
                  <div style={{ flex: 1, maxWidth: 18, height: `${(b.outflow / max) * 100}%`, minHeight: b.outflow > 0 ? 2 : 0, background: `linear-gradient(180deg, ${SOFT_RED} 0%, ${bRgba(SOFT_RED, 0.45)} 100%)`, borderRadius: "4px 4px 0 0", boxShadow: hover === i ? `0 0 16px ${bRgba(SOFT_RED, 0.6)}` : `0 0 8px ${bRgba(SOFT_RED, 0.18)}`, transition: "box-shadow .15s ease" }} />
                  {hover === i && (
                    <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translate(-50%, -6px)", background: "rgba(5,8,14,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${bRgba(LIGHT_BLUE, 0.22)}`, borderRadius: 8, padding: "6px 10px", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.muted, opacity: 0.7 }}>{b.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.green }}>In {fmtMoney(b.inflow, currency)}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: SOFT_RED }}>Out {fmtMoney(b.outflow, currency)}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: LIGHT_BLUE, marginTop: 2, borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 3 }}>Bal {fmtMoney(balances[i], currency)}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, fontSize: 12, color: HOME_THEME.muted }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: HOME_THEME.green }} />In</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: SOFT_RED }} />Out</span>
        </div>
        <div style={{ display: "flex", gap: buckets.length > 20 ? 2 : 8, marginTop: 8 }}>
          {buckets.map((b, i) => (
            <div key={`${b.label}-l-${i}`} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 12, color: HOME_THEME.muted, opacity: hover === i ? 1 : 0.5, overflow: "hidden", whiteSpace: "nowrap" }}>
              {buckets.length > 16 && i % 2 === 1 ? "" : b.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Rent card — countdown to the 5th plus a to-the-5th cash-flow projection:
 *  what's still coming in (e.g. both pay runs) and going out before rent, and
 *  whether that clears rent when it's due. */
function RentCountdown({
  info,
  currency,
}: {
  info: {
    rentAmount: number; daysUntil: number; dueIso: string; paid: boolean; available: number;
    incoming: { label: string; amount: number; date: string }[];
    outgoing: { label: string; amount: number; date: string }[];
    incomingTotal: number; outgoingTotal: number; projected: number;
    shortfall: number; perDay: number;
  };
  currency: string;
}) {
  const { rentAmount, daysUntil, dueIso, paid, available, incoming, outgoing, incomingTotal, outgoingTotal, projected, shortfall, perDay } = info;
  const covered = rentAmount > 0 && shortfall <= 0;
  const pct = rentAmount > 0 ? Math.min(100, Math.max(0, (projected / rentAmount) * 100)) : 0;
  const accent = paid || covered ? HOME_THEME.green : shortfall > 0 ? SOFT_RED : LIGHT_BLUE;
  const surplus = projected - rentAmount;

  const flowLine = (f: { label: string; amount: number; date: string }, key: string, positive: boolean) => (
    <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: HOME_THEME.muted, marginTop: 3 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {f.label} <span style={{ opacity: 0.5 }}>· {shortDate(f.date)}</span>
      </span>
      <span style={{ fontWeight: 700, color: positive ? HOME_THEME.green : SOFT_RED, flexShrink: 0 }}>
        {positive ? "+" : ""}{fmtMoney(f.amount, currency)}
      </span>
    </div>
  );

  return (
    <div style={{ ...card(), padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Rent</div>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6 }}>Due {shortDate(dueIso)} · the 5th</span>
      </div>

      {rentAmount === 0 ? (
        <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.7, padding: "8px 0" }}>
          Add a recurring payment with “Rent” in the label to track the countdown.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 42, fontWeight: 900, letterSpacing: "-0.02em", color: accent, lineHeight: 1 }}>
              {paid ? "Paid" : daysUntil === 0 ? "Today" : daysUntil}
            </span>
            {!paid && daysUntil > 0 && <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.muted }}>day{daysUntil === 1 ? "" : "s"} to rent</span>}
            {paid && <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.green }}>✓ this month</span>}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.muted, marginTop: 12 }}>
            <span>Rent</span>
            <span style={{ fontWeight: 800, color: HOME_THEME.text }}>{fmtMoney(rentAmount, currency)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.muted, marginTop: 4 }}>
            <span>On hand now</span>
            <span style={{ fontWeight: 800, color: available < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(available, currency)}</span>
          </div>

          {!paid && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${HOME_THEME.border}` }}>
              {/* What else lands before rent — e.g. both pay runs. */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.muted }}>
                <span>Coming in by the 5th</span>
                <span style={{ color: incomingTotal > 0 ? HOME_THEME.green : HOME_THEME.muted }}>+{fmtMoney(incomingTotal, currency)}</span>
              </div>
              {incoming.length
                ? incoming.map((f, i) => flowLine(f, "in" + i, true))
                : <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.5, marginTop: 3 }}>Nothing scheduled</div>}

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.muted, marginTop: 10 }}>
                <span>Going out by the 5th</span>
                <span style={{ color: outgoingTotal > 0 ? SOFT_RED : HOME_THEME.muted }}>{outgoingTotal > 0 ? "−" : ""}{fmtMoney(outgoingTotal, currency)}</span>
              </div>
              {outgoing.length
                ? outgoing.map((f, i) => flowLine(f, "out" + i, false))
                : <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.5, marginTop: 3 }}>Nothing scheduled</div>}

              {/* Cash on hand the moment rent is due — BEFORE rent leaves. The
                  window is inclusive of the 5th, so same-day pay counts here. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text }}>Projected on the 5th, for rent</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: HOME_THEME.muted, opacity: 0.7 }}>before rent is paid</span>
                </span>
                <span style={{ fontSize: 17, fontWeight: 900, color: accent }}>{fmtMoney(projected, currency)}</span>
              </div>
            </div>
          )}

          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.07)", margin: "12px 0 6px", overflow: "hidden" }}>
            <div style={{ height: 8, borderRadius: 99, background: accent, width: `${pct}%`, transition: "width 0.2s ease" }} />
          </div>

          {paid ? (
            <div style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.green, marginTop: 6 }}>
              Rent is paid for this month.
            </div>
          ) : covered ? (
            <div style={{ marginTop: 8, borderRadius: 10, background: bRgba(HOME_THEME.green, 0.10), border: `1px solid ${bRgba(HOME_THEME.green, 0.3)}`, padding: "10px 12px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.green }}>Enough coming in — rent's covered.</div>
              <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.8, marginTop: 2 }}>
                {fmtMoney(surplus, currency)} to spare after rent{daysUntil > 0 ? ` on the 5th` : ""}.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8, borderRadius: 10, background: bRgba(SOFT_RED, 0.10), border: `1px solid ${bRgba(SOFT_RED, 0.3)}`, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, color: HOME_THEME.muted }}>Still short by <span style={{ fontWeight: 800, color: SOFT_RED }}>{fmtMoney(shortfall, currency)}</span> after what's due{daysUntil > 0 ? ` in ${daysUntil} day${daysUntil === 1 ? "" : "s"}` : " today"}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: SOFT_RED, marginTop: 2 }}>
                {fmtMoney(perDay, currency)}<span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.muted }}> /day extra</span>
              </div>
              <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.7, marginTop: 2 }}>
                to make rent {daysUntil > 0 ? `over the next ${daysUntil} day${daysUntil === 1 ? "" : "s"}` : "today"}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Editable bank table — Truist, Coastal, SECU. Writes the daily balance. */
function BankAccountsCard({
  value,
  currency,
  onSave,
  fallback,
}: {
  value: DailyBalance | null;
  currency: string;
  onSave: (day: string, coastal: number, truist: number, secu: number) => void;
  fallback: Record<Bank, number>;
}) {
  const seed = (b: Bank) => String(value ? value[b] : fallback[b] ?? 0);
  const [vals, setVals] = useState<Record<Bank, string>>({ truist: seed("truist"), coastal: seed("coastal"), secu: seed("secu") });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (value) setVals({ truist: String(value.truist), coastal: String(value.coastal), secu: String(value.secu) });
  }, [value?.truist, value?.coastal, value?.secu]);

  const total = (Number(vals.truist) || 0) + (Number(vals.coastal) || 0) + (Number(vals.secu) || 0);
  const today = todayIso();
  const isToday = value?.day === today;
  const save = () => {
    onSave(today, Number(vals.coastal) || 0, Number(vals.truist) || 0, Number(vals.secu) || 0);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const ORDER: Bank[] = ["truist", "coastal", "secu"];

  return (
    <div style={{ ...card(), padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Bank Accounts</div>
        <span style={{ fontSize: 12, color: isToday ? HOME_THEME.green : HOME_THEME.muted, opacity: isToday ? 1 : 0.55 }}>
          {value ? (isToday ? "updated today" : `as of ${shortDate(value.day)}`) : "not set today"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ORDER.map((b) => (
          <div key={b} style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${HOME_THEME.border}` }}>
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.text }}>{BANK_LABEL[b]}</span>
            <input
              value={vals[b]}
              onChange={(e) => setVals((p) => ({ ...p, [b]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              type="number"
              placeholder="0"
              style={{ ...field(), padding: "7px 10px", fontSize: 14, textAlign: "right" }}
            />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 4px" }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>Total</span>
          <span style={{ fontSize: 17, fontWeight: 900, color: total < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(total, currency)}</span>
        </div>
      </div>
      <button onClick={save} style={{ ...primary(), marginTop: 10, width: "100%", padding: "9px 14px", fontSize: 12 }}>{saved ? "Saved ✓" : "Save balances"}</button>
    </div>
  );
}

/** Upcoming pay — what's still owed this month (the VAT/MTD slot). */
function UpcomingPayCard({
  data,
  pastDue = [],
  currency,
  onMarkPaid,
}: {
  data: { items: { label: string; amount: number; date: string; bank: Bank; tag: string }[]; total: number; next: { label: string; amount: number; date: string; bank: Bank; tag: string } | null };
  pastDue?: { label: string; amount: number; date: string; days: number; tag: string; bank: Bank }[];
  currency: string;
  onMarkPaid: (bill: { date: string; label: string; bank: Bank; amount: number; tag: string }) => void;
}) {
  const pastDueTotal = pastDue.reduce((s, b) => s + Math.abs(b.amount), 0);
  return (
    <div style={{ ...card(), padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Upcoming Pay</div>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.55 }}>{data.items.length} left</span>
      </div>

      {pastDue.length > 0 && (
        <div style={{ marginBottom: 12, borderRadius: 10, background: bRgba(HOME_THEME.red, 0.10), border: `1px solid ${bRgba(HOME_THEME.red, 0.3)}`, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "8px 12px" }}>
            <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: SOFT_RED }}>{pastDue.length} Past due</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: SOFT_RED }}>{fmtMoney(pastDueTotal, currency)}</span>
          </div>
          {pastDue.map((b) => (
            <div key={b.tag} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "8px 12px", borderTop: `1px solid ${bRgba(HOME_THEME.red, 0.2)}` }}>
              <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.label}
                <span style={{ fontSize: 12, color: HOME_THEME.muted, fontWeight: 600 }}> · {-b.days}d ago</span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(Math.abs(b.amount), currency)}</span>
              <button onClick={() => onMarkPaid({ date: b.date, label: b.label, bank: b.bank, amount: b.amount, tag: b.tag })} style={{ ...ghost(), padding: "4px 8px", fontSize: 12, borderRadius: 8 }}>Pay</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6 }}>Total due</span>
        <span style={{ fontSize: 22, fontWeight: 900, color: data.total > 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(data.total, currency)}</span>
      </div>
      {data.items.length === 0 ? (
        <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.6 }}>Nothing left to pay this month.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {data.items.slice(0, 5).map((b) => (
            <div key={b.tag} style={{ display: "grid", gridTemplateColumns: "48px 1fr auto auto", gap: 8, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${HOME_THEME.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.muted, opacity: 0.6 }}>{shortDate(b.date)}</span>
              <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(Math.abs(b.amount), currency)}</span>
              <button onClick={() => onMarkPaid({ date: b.date, label: b.label, bank: b.bank, amount: b.amount, tag: b.tag })} style={{ ...ghost(), padding: "4px 8px", fontSize: 12, borderRadius: 8 }}>Pay</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Recent transactions — real logged rows, i.e. what has actually been paid. */
function RecentTransactions({ rows, currency, categories = [] }: { rows: RegisterRow[]; currency: string; categories?: Category[] }) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  return (
    <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 16px 4px" }}>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Recent Transactions</div>
        <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.55, marginTop: 2 }}>Logged this month · what has been paid</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            <th style={th("left")}>Date</th>
            <th style={th("left")}>Item</th>
            <th style={th("left")}>Category</th>
            <th style={th("right")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={4} style={{ padding: "22px 16px", color: HOME_THEME.muted, opacity: 0.6, textAlign: "center" }}>Nothing logged this month yet.</td></tr>
          )}
          {rows.map((r) => {
            const inc = r.amount > 0;
            const cat = r.category_id != null ? catById.get(r.category_id) : null;
            const cc = cat?.color || LIGHT_BLUE;
            return (
              <tr key={r.id} style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
                <td style={{ padding: "11px 16px", color: HOME_THEME.muted, opacity: 0.7, whiteSpace: "nowrap" }}>{shortDate(r.entry_date)} <span style={{ opacity: 0.6 }}>{weekday(r.entry_date)}</span></td>
                <td style={{ padding: "11px 16px", fontWeight: 700 }}>
                  {r.label}
                  <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6, fontWeight: 600, letterSpacing: "0.06em" }}>{BANK_LABEL[r.bank]}</div>
                </td>
                <td style={{ padding: "11px 16px" }}>
                  {cat ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, color: cc, background: bRgba(cc, 0.10), border: `1px solid ${bRgba(cc, 0.3)}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: cc }} />
                      {cat.name}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, color: HOME_THEME.muted, background: bRgba("#ffffff", 0.04), border: `1px solid ${HOME_THEME.border}` }}>Unsorted</span>
                  )}
                </td>
                <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 800, color: inc ? HOME_THEME.green : SOFT_RED }}>{inc ? "+" : ""}{fmtMoney(r.amount, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Category spend — this month's spend per category from the Categories page. */
function CategorySpendCard({
  categories,
  spent,
  unsortedCount,
  unsortedTotal,
  currency,
  onOpenCategories,
  range,
  budgetScale,
}: {
  categories: Category[];
  spent: Record<number, number>;
  unsortedCount: number;
  unsortedTotal: number;
  currency: string;
  onOpenCategories: () => void;
  range: RangeMode;
  /** Category budgets are monthly — scale them to the window being shown. */
  budgetScale: number;
}) {
  const rows = categories
    .map((c) => ({ c, s: spent[c.id] || 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);

  return (
    <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Category Spend</div>
          <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.55, marginTop: 2 }}>
            {fmtMoney(totalSpent, currency)} categorized · {RANGE_WINDOW_LABEL[range].toLowerCase()}
          </div>
        </div>
        <button onClick={onOpenCategories} style={{ ...ghost(), padding: "5px 10px", fontSize: 12, borderRadius: 8 }}>Manage</button>
      </div>

      {unsortedCount > 0 && (
        <button
          onClick={onOpenCategories}
          style={{
            width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
            padding: "10px 16px", background: bRgba(HOME_THEME.orange, 0.10),
            borderTop: `1px solid ${HOME_THEME.border}`, borderBottom: `1px solid ${HOME_THEME.border}`, borderLeft: "none", borderRight: "none",
            color: HOME_THEME.text,
          }}
        >
          <span style={{ flex: 1, fontSize: 14 }}>
            {unsortedCount} unsorted transaction{unsortedCount === 1 ? "" : "s"} — {fmtMoney(unsortedTotal, currency)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.orange }}>Sort now →</span>
        </button>
      )}

      <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.length === 0 && (
          <div style={{ padding: "18px 0", textAlign: "center", fontSize: 14, color: HOME_THEME.muted, opacity: 0.6 }}>
            No categories yet — add them on the Categories tab.
          </div>
        )}
        {rows.map(({ c, s }) => {
          const budget = (c.amount || 0) * budgetScale;
          const pct = budget > 0 ? Math.min(100, (s / budget) * 100) : 0;
          const over = budget > 0 && s > budget;
          const cc = c.color || LIGHT_BLUE;
          return (
            <div key={c.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: cc, flex: "none" }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{c.name}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: over ? SOFT_RED : HOME_THEME.text }}>
                  {fmtMoney(s, currency)}
                  <span style={{ color: HOME_THEME.muted, fontWeight: 600 }}> / {budget > 0 ? fmtMoney(budget, currency) : "—"}</span>
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: bRgba("#ffffff", 0.06), overflow: "hidden" }}>
                <div style={{ width: `${budget > 0 ? pct : 0}%`, height: "100%", borderRadius: 999, background: over ? SOFT_RED : cc, transition: "width 0.2s ease" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The colour dot on a category tile, doubling as its editor. Closed it is just
// the dot; open it drops a small popover with the six house swatches plus a
// native picker for anything else. Kept local to this file because nothing else
// needs it — the dot IS the button, so the tile gains no extra chrome.
function ColorEditor({
  value,
  open,
  onClose,
  onPick,
}: {
  value: string;
  open: boolean;
  onClose: () => void;
  onPick: (color: string) => void;
}) {
  // Native <input type="color"> only speaks 6-digit hex; anything else (an
  // rgba() from the theme, a short hex) would make it fall back to black, so
  // seed it with a safe default instead of a value it can't parse.
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#7dd3fc";

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <span
        role="button"
        title="Change colour"
        aria-label="Change category colour"
        style={{
          width: 12, height: 12, borderRadius: 3, background: value, flex: "none", cursor: "pointer",
          boxShadow: open ? `0 0 0 2px ${HOME_THEME.text}` : `0 0 0 1px rgba(255,255,255,0.18)`,
        }}
      />
      {open && (
        <>
          {/* Click-away catcher. Sits under the popover, over everything else. */}
          <span
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <span
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: 20, left: -6, zIndex: 41,
              display: "flex", alignItems: "center", gap: 6, padding: 8,
              borderRadius: 10, background: HOME_THEME.panel,
              border: `1px solid ${HOME_THEME.border}`,
              boxShadow: "0 12px 30px -8px rgba(0,0,0,0.8)",
            }}
          >
            {CATEGORY_COLORS.map((cc) => (
              <button
                key={cc}
                onClick={(e) => { e.stopPropagation(); onPick(cc); }}
                aria-label={`Use ${cc}`}
                style={{
                  width: 20, height: 20, borderRadius: 6, background: cc, cursor: "pointer",
                  border: value.toLowerCase() === cc.toLowerCase() ? `2px solid ${HOME_THEME.text}` : `1px solid ${HOME_THEME.border}`,
                }}
              />
            ))}
            {/* Anything outside the six. Commits on change, same as a swatch. */}
            <input
              type="color"
              value={hex}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onPick(e.target.value)}
              aria-label="Custom colour"
              title="Custom colour"
              style={{
                width: 24, height: 22, padding: 0, cursor: "pointer",
                background: "transparent", border: `1px solid ${HOME_THEME.border}`, borderRadius: 6,
              }}
            />
          </span>
        </>
      )}
    </span>
  );
}

// Categories tab: brain-dump/unsorted assignment, per-category budget tiles, and
// an add-category composer. Budgets live in budget_categories; spend is summed
// from this month's assigned register rows.
function CategoriesPanel({
  categories,
  spent,
  unsorted,
  unsortedTotal,
  byCategory,
  currency,
  onAdd,
  onDelete,
  onColor,
  onAssign,
  onDeleteRow,
}: {
  categories: Category[];
  spent: Record<number, number>;
  unsorted: RegisterRow[];
  unsortedTotal: number;
  byCategory: Record<number, RegisterRow[]>;
  currency: string;
  onAdd: (name: string, amount: number, color: string) => void;
  onDelete: (id: number) => void;
  onColor: (cat: Category, color: string) => void;
  onAssign: (rowId: number, categoryId: number | null) => void;
  onDeleteRow: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [openCat, setOpenCat] = useState<Category | null>(null);
  // Which category's colour popover is open (null = none). Only one at a time.
  const [editColorId, setEditColorId] = useState<number | null>(null);

  const add = () => {
    if (!name.trim()) return;
    onAdd(name, Number(budget || 0), color);
    setName("");
    setBudget("");
  };

  const catOptions = [{ value: "", label: "Unsorted" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))];

  return (
    <div style={{ ...cardAccent(2), padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>Categories</div>
        <span style={{ fontSize: 14, color: HOME_THEME.muted }}>{categories.length} categor{categories.length === 1 ? "y" : "ies"}</span>
      </div>

      {unsorted.length > 0 && (
        <div style={{ borderRadius: 12, border: `1px dashed ${bRgba("#7dd3fc", 0.3)}`, background: bRgba("#7dd3fc", 0.05), padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>🧠 Brain dump — to sort</div>
              <div style={{ fontSize: 14, color: HOME_THEME.muted }}>Give each one a home</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(unsortedTotal, currency)}</div>
              <div style={{ fontSize: 14, color: HOME_THEME.muted }}>{unsorted.length} item{unsorted.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {unsorted.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 150px 90px", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 14, color: HOME_THEME.muted }}>{shortDate(r.entry_date)}</span>
                <span style={{ fontSize: 14, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                <ThemedSelect value="" onChange={(v) => onAssign(r.id, v ? Number(v) : null)} options={catOptions} />
                <span style={{ fontSize: 14, fontWeight: 800, color: SOFT_RED, textAlign: "right" }}>{fmtMoney(r.amount, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {categories.length === 0 && <div style={{ fontSize: 14, color: HOME_THEME.muted, padding: "6px 2px" }}>No categories yet — add one below to start budgeting.</div>}
        {categories.map((c) => {
          const s = spent[c.id] || 0;
          const budgetAmt = c.amount || 0;
          const left = budgetAmt - s;
          const pct = budgetAmt > 0 ? Math.min(100, (s / budgetAmt) * 100) : 0;
          const over = budgetAmt > 0 && s > budgetAmt;
          const dot = c.color || HOME_THEME.cyan;
          const count = (byCategory[c.id] || []).length;
          return (
            <div key={c.id} onClick={() => setOpenCat(c)} title="View transactions in this category" style={{ ...card(), padding: 12, cursor: "pointer", position: "relative", overflow: "visible" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, minWidth: 0 }}>
                  {/* The dot is the edit affordance: click it to recolour the
                      category. stopPropagation so it doesn't also open the
                      transactions modal that the card click owns. */}
                  <span onClick={(e) => { e.stopPropagation(); setEditColorId(editColorId === c.id ? null : c.id); }} style={{ display: "inline-flex", flex: "none" }}>
                    <ColorEditor
                      value={dot}
                      open={editColorId === c.id}
                      onClose={() => setEditColorId(null)}
                      onPick={(next) => { onColor(c, next); setEditColorId(null); }}
                    />
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  {count > 0 && <span style={{ fontSize: 14, color: HOME_THEME.muted, flex: "none" }}>· {count}</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                  <span style={{ fontSize: 14, color: HOME_THEME.text }}>{fmtMoney(s, currency)} <span style={{ color: HOME_THEME.muted }}>/ {budgetAmt > 0 ? fmtMoney(budgetAmt, currency) : "—"}</span></span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}><DeleteButton onClick={() => onDelete(c.id)} /></span>
                </span>
              </div>
              {budgetAmt > 0 ? (
                <>
                  <div style={{ height: 5, borderRadius: 99, background: "rgba(255,255,255,0.06)", marginBottom: 6 }}>
                    <div style={{ height: 5, borderRadius: 99, background: over ? SOFT_RED : dot, width: `${pct}%` }} />
                  </div>
                  <div style={{ fontSize: 14, color: over ? SOFT_RED : HOME_THEME.muted }}>{over ? `${fmtMoney(-left, currency)} over` : `${fmtMoney(left, currency)} left`}</div>
                </>
              ) : (
                <div style={{ fontSize: 14, color: HOME_THEME.muted }}>No budget — just tracking</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px auto auto", gap: 10, alignItems: "center", borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New category (Groceries, Fun…)" style={field()} />
        <input value={budget} onChange={(e) => setBudget(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Monthly budget" type="number" style={field()} />
        <div style={{ display: "flex", gap: 6 }}>
          {CATEGORY_COLORS.map((cc) => (
            <button key={cc} onClick={() => setColor(cc)} aria-label="Pick colour" style={{ width: 22, height: 22, borderRadius: 6, background: cc, border: color === cc ? `2px solid ${HOME_THEME.text}` : `1px solid ${HOME_THEME.border}`, cursor: "pointer" }} />
          ))}
        </div>
        <button onClick={add} style={primary()}>Add category</button>
      </div>

      {openCat && createPortal(
        <div
          onClick={() => setOpenCat(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...card(), width: 660, maxWidth: "100%", maxHeight: "80vh", overflow: "auto", padding: 0, background: HOME_THEME.panel }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, position: "sticky", top: 0, background: HOME_THEME.panel, zIndex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: openCat.color || HOME_THEME.cyan, flex: "none" }} />
                <span style={{ fontSize: 17, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{openCat.name}</span>
                <span style={{ fontSize: 14, color: HOME_THEME.muted, flex: "none" }}>{fmtMoney(spent[openCat.id] || 0, currency)} spent</span>
              </div>
              <button onClick={() => setOpenCat(null)} style={{ ...ghost(), padding: "6px 12px" }}>Close</button>
            </div>
            <div style={{ padding: 12 }}>
              {(byCategory[openCat.id] || []).length === 0 ? (
                <div style={{ padding: "24px 12px", textAlign: "center", color: HOME_THEME.muted, fontSize: 14 }}>No transactions in this category yet.</div>
              ) : (
                (byCategory[openCat.id] || []).map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "60px 1fr 150px auto auto", gap: 8, alignItems: "center", padding: "8px 6px", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
                    <span style={{ fontSize: 14, color: HOME_THEME.muted }}>{shortDate(r.entry_date)}</span>
                    <span style={{ fontSize: 14, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
                    {/* Re-file a row that already has a category — pick another
                        one, or "Unsorted" to send it back to the brain dump. */}
                    <ThemedSelect
                      value={String(openCat.id)}
                      onChange={(v) => onAssign(r.id, v ? Number(v) : null)}
                      options={catOptions}
                      ariaLabel="Move to category"
                    />
                    <span style={{ fontSize: 14, fontWeight: 800, color: SOFT_RED, textAlign: "right", minWidth: 90 }}>{fmtMoney(r.amount, currency)}</span>
                    <DeleteButton onClick={() => onDeleteRow(r.id)} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Year dashboard (ZenMoney-style): summary cards, monthly cash-flow bars,
// spending-by-category donut, budget-overview bars, and the month table.
function YearlyPanel({
  data,
  categories,
  year,
  onYear,
  currency,
  loading,
}: {
  data: {
    months: { ym: string; m: number; start: number; income: number; expenses: number; end: number; leftover: number; active: boolean }[];
    totals: { income: number; expenses: number; leftover: number };
    start: number;
    end: number;
    catSpend: Record<number, number>;
    uncategorized: number;
  };
  categories: Category[];
  year: number;
  onYear: (y: number) => void;
  currency: string;
  loading: boolean;
}) {
  const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const monthShort = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "narrow" });

  const cards = [
    { label: "Year-end balance", value: data.end, color: data.end < 0 ? SOFT_RED : HOME_THEME.cyan, icon: "🏦" },
    { label: "Total income", value: data.totals.income, color: HOME_THEME.green, icon: "📈" },
    { label: "Total expenses", value: data.totals.expenses, color: SOFT_RED, icon: "📉" },
    { label: "Net / left over", value: data.totals.leftover, color: data.totals.leftover < 0 ? SOFT_RED : HOME_THEME.green, icon: "💵" },
  ];

  // Cash-flow bars.
  const CW = 720, CH = 200, padB = 22, padT = 8, padX = 8;
  const maxVal = Math.max(1, ...data.months.map((mo) => Math.max(mo.income, mo.expenses)));
  const bandW = (CW - padX * 2) / 12;
  const plotH = CH - padT - padB;

  // Spending donut slices.
  const slices = [
    ...categories.map((c) => ({ label: c.name, amount: data.catSpend[c.id] || 0, color: c.color || HOME_THEME.cyan })),
    { label: "Unsorted", amount: data.uncategorized, color: "rgba(255,255,255,0.28)" },
  ].filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  const donutTotal = slices.reduce((s, x) => s + x.amount, 0);
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;

  const budgeted = categories.filter((c) => (c.amount || 0) > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...dissolveCard(), padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>{year} — Year dashboard</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => onYear(year - 1)} style={{ ...ghost(), padding: "6px 12px" }}>◀</button>
          <span style={{ fontSize: 17, fontWeight: 900, minWidth: 56, textAlign: "center" }}>{year}</span>
          <button onClick={() => onYear(year + 1)} style={{ ...ghost(), padding: "6px 12px" }}>▶</button>
          {loading && <span style={{ fontSize: 14, color: HOME_THEME.muted, marginLeft: 6 }}>Loading…</span>}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ ...dissolveCard(), padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17 }}>{c.icon}</span>
              <span style={labelCap()}>{c.label}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 900, color: c.color }}>{fmtMoney(c.value, currency)}</div>
          </div>
        ))}
      </div>

      {/* Cash flow bar chart */}
      <div style={{ ...dissolveCard(), padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted }}>CASH FLOW</div>
          <div style={{ display: "flex", gap: 14, fontSize: 14, color: HOME_THEME.muted }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: HOME_THEME.green, marginRight: 5 }} />Income</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: SOFT_RED, marginRight: 5 }} />Expenses</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: "block" }}>
          {data.months.map((mo, i) => {
            const x0 = padX + i * bandW;
            const barW = bandW * 0.26;
            const gap = bandW * 0.08;
            const incH = (mo.income / maxVal) * plotH;
            const expH = (mo.expenses / maxVal) * plotH;
            const baseY = CH - padB;
            return (
              <g key={mo.ym}>
                <rect x={x0 + bandW / 2 - barW - gap / 2} y={baseY - incH} width={barW} height={incH} rx={2} fill={HOME_THEME.green} />
                <rect x={x0 + bandW / 2 + gap / 2} y={baseY - expH} width={barW} height={expH} rx={2} fill={SOFT_RED} />
                <text x={x0 + bandW / 2} y={CH - 6} fill={HOME_THEME.muted} fontSize={12} textAnchor="middle">{monthShort(mo.m)}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Spending donut + budget overview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "stretch" }}>
        <div style={{ ...dissolveCard(), padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>SPENDING BREAKDOWN</div>
          {donutTotal <= 0 ? (
            <div style={{ padding: "24px 0", color: HOME_THEME.muted, fontSize: 14 }}>No categorized spending this year yet.</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <svg viewBox="0 0 140 140" width="140" height="140" style={{ flex: "none" }}>
                {slices.map((s, i) => {
                  const dash = (s.amount / donutTotal) * C;
                  const el = <circle key={i} cx={70} cy={70} r={R} fill="none" stroke={s.color} strokeWidth={16} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />;
                  acc += dash;
                  return el;
                })}
                <text x={70} y={66} textAnchor="middle" fill={HOME_THEME.text} fontSize={16} fontWeight={900}>{fmtMoney(donutTotal, currency)}</text>
                <text x={70} y={82} textAnchor="middle" fill={HOME_THEME.muted} fontSize={11}>spent</text>
              </svg>
              <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 6 }}>
                {slices.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: "none" }} />
                      <span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                    </span>
                    <span style={{ fontSize: 14, color: HOME_THEME.muted, flex: "none" }}>{Math.round((s.amount / donutTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ ...dissolveCard(), padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>BUDGET OVERVIEW</div>
          {budgeted.length === 0 ? (
            <div style={{ padding: "24px 0", color: HOME_THEME.muted, fontSize: 14 }}>No category budgets set.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {budgeted.map((c) => {
                const annual = (c.amount || 0) * 12;
                const spent = data.catSpend[c.id] || 0;
                const pct = annual > 0 ? Math.min(100, (spent / annual) * 100) : 0;
                const over = spent > annual;
                const dot = c.color || HOME_THEME.cyan;
                return (
                  <div key={c.id}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: dot }} />{c.name}
                      </span>
                      <span style={{ fontSize: 14, color: HOME_THEME.muted }}>{fmtMoney(spent, currency)} <span style={{ opacity: 0.6 }}>/ {fmtMoney(annual, currency)}</span></span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.06)" }}>
                      <div style={{ height: 6, borderRadius: 99, background: over ? SOFT_RED : dot, width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Month table */}
      <div style={{ ...dissolveCard(), padding: 16, overflowX: "auto" }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>YEAR OVERVIEW</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={th("left")}>Month</th>
              <th style={th("right")}>Start balance</th>
              <th style={th("right")}>Income</th>
              <th style={th("right")}>Expenses</th>
              <th style={th("right")}>End of month</th>
              <th style={th("right")}>Left over</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((mo) => (
              <tr key={mo.ym} style={{ borderBottom: `1px solid ${HOME_THEME.border}`, opacity: mo.active ? 1 : 0.4 }}>
                <td style={{ padding: "10px 12px", fontWeight: 800 }}>{monthName(mo.m)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: mo.start < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(mo.start, currency)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: HOME_THEME.green }}>{fmtMoney(mo.income, currency)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: SOFT_RED }}>{fmtMoney(mo.expenses, currency)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: mo.end < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(mo.end, currency)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: mo.leftover < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(mo.leftover, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${HOME_THEME.border}` }}>
              <td style={{ padding: 12, fontWeight: 900, textTransform: "uppercase", fontSize: 14, letterSpacing: "0.1em", color: HOME_THEME.muted }}>Total</td>
              <td style={{ padding: 12, textAlign: "right", color: HOME_THEME.muted }}>{fmtMoney(data.start, currency)}</td>
              <td style={{ padding: 12, textAlign: "right", fontWeight: 900, color: HOME_THEME.green }}>{fmtMoney(data.totals.income, currency)}</td>
              <td style={{ padding: 12, textAlign: "right", fontWeight: 900, color: SOFT_RED }}>{fmtMoney(data.totals.expenses, currency)}</td>
              <td style={{ padding: 12, textAlign: "right", fontWeight: 900, color: data.end < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(data.end, currency)}</td>
              <td style={{ padding: 12, textAlign: "right", fontWeight: 900, color: data.totals.leftover < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(data.totals.leftover, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// Bzila — the business ledger. Year summary + per-stream breakdown (CB Edge /
// Contracts / Prop) + monthly rows that expand to their entries. Contracts rows
// are read out of the Payments register, so they're shown but not editable here.
type BzilaStreamTotal = { inAmt: number; outAmt: number; net: number };
function BzilaPanel({
  data,
  year,
  currency,
  onDelete,
  onOpenPayments,
}: {
  data: {
    months: { ym: string; rows: BzilaEntry[]; inAmt: number; outAmt: number; net: number }[];
    totalIn: number;
    totalOut: number;
    net: number;
    streams: { cbedge: BzilaStreamTotal; contracts: BzilaStreamTotal; prop: BzilaStreamTotal };
  };
  year: number;
  currency: string;
  onDelete: (id: number) => void;
  onOpenPayments: () => void;
}) {
  const [open, setOpen] = useState<string | null>(data.months[0]?.ym ?? null);
  const monthName = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  };
  const STREAM_COLOR: Record<BzilaEntry["stream"], string> = {
    cbedge: HOME_THEME.cyan,
    contracts: LIGHT_BLUE,
    prop: HOME_THEME.orange,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Year summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <StatTile label={`${year} Income`} value={fmtMoney(data.totalIn, currency)} sub="CB Edge · contracts · payouts" valueColor={HOME_THEME.green} />
        <StatTile label="Expenses" value={fmtMoney(data.totalOut, currency)} sub="All three streams" valueColor={SOFT_RED} />
        <StatTile label="Net" value={fmtMoney(data.net, currency)} sub="Income − expenses" valueColor={data.net < 0 ? SOFT_RED : HOME_THEME.green} />
      </div>

      {/* Per-stream breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {(["cbedge", "contracts", "prop"] as const).map((s) => {
          const t = data.streams[s];
          return (
            <div key={s} style={{ ...card(), padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: STREAM_COLOR[s] }} />
                <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>{STREAM_LABEL[s]}</span>
                {s === "contracts" && (
                  <button onClick={onOpenPayments} style={{ ...ghost(), marginLeft: "auto", padding: "3px 8px", fontSize: 10, borderRadius: 7 }}>From Payments</button>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.muted }}>
                <span>In</span><span style={{ fontWeight: 800, color: HOME_THEME.green }}>{fmtMoney(t.inAmt, currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.muted, marginTop: 3 }}>
                <span>Out</span><span style={{ fontWeight: 800, color: SOFT_RED }}>{fmtMoney(t.outAmt, currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
                <span style={{ color: HOME_THEME.muted, fontWeight: 700 }}>Net</span>
                <span style={{ fontWeight: 900, color: t.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(t.net, currency)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Monthly All ledger — all three streams */}
      <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 16px", borderBottom: `1px solid ${HOME_THEME.border}` }}>
          <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>Monthly All</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: HOME_THEME.muted }}>{year} · all streams</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 26px", padding: "11px 16px", background: HOME_THEME.panel, fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.muted }}>
          <span>Month</span>
          <span style={{ textAlign: "right" }}>In</span>
          <span style={{ textAlign: "right" }}>Out</span>
          <span style={{ textAlign: "right" }}>Net</span>
          <span />
        </div>

        {data.months.length === 0 && (
          <div style={{ padding: "26px 16px", textAlign: "center", color: HOME_THEME.muted }}>Nothing logged for {year} yet.</div>
        )}

        {data.months.map((m) => {
          const isOpen = open === m.ym;
          return (
            <div key={m.ym} style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
              <button
                onClick={() => setOpen(isOpen ? null : m.ym)}
                style={{ width: "100%", textAlign: "left", cursor: "pointer", background: isOpen ? "rgba(255,255,255,0.03)" : "transparent", border: "none", color: HOME_THEME.text, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 26px", padding: "12px 16px", alignItems: "center", fontSize: 14 }}
              >
                <span style={{ fontWeight: 800 }}>{monthName(m.ym)}</span>
                <span style={{ textAlign: "right", color: m.inAmt > 0 ? HOME_THEME.green : HOME_THEME.muted }}>{fmtMoney(m.inAmt, currency)}</span>
                <span style={{ textAlign: "right", color: m.outAmt > 0 ? SOFT_RED : HOME_THEME.muted }}>{fmtMoney(m.outAmt, currency)}</span>
                <span style={{ textAlign: "right", fontWeight: 900, color: m.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(m.net, currency)}</span>
                <span style={{ textAlign: "right", color: HOME_THEME.muted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>›</span>
              </button>

              {isOpen && (
                <div style={{ background: "rgba(0,0,0,0.18)", borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "0.9fr 0.8fr 1.3fr 0.5fr 1fr 26px", padding: "7px 16px 7px 30px", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>
                    <span>Date</span><span>Stream</span><span>Item</span><span style={{ textAlign: "center" }}>Accts</span><span style={{ textAlign: "right" }}>Amount</span><span />
                  </div>
                  {m.rows.map((r) => {
                    const isIn = r.inAmt > 0;
                    const c = STREAM_COLOR[r.stream];
                    return (
                      <div key={r.key} style={{ display: "grid", gridTemplateColumns: "0.9fr 0.8fr 1.3fr 0.5fr 1fr 26px", padding: "9px 16px 9px 30px", alignItems: "center", fontSize: 14, borderTop: `1px solid ${bRgba("#ffffff", 0.05)}` }}>
                        <span style={{ fontWeight: 700 }}>{r.stream === "cbedge" ? new Date(r.date + "T00:00:00").toLocaleDateString("en-US", { month: "long" }) : <>{shortDate(r.date)} <span style={{ color: HOME_THEME.muted, fontWeight: 400 }}>{weekday(r.date)}</span></>}</span>
                        <span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 999, color: c, background: bRgba(c, 0.10), border: `1px solid ${bRgba(c, 0.3)}` }}>
                            {STREAM_LABEL[r.stream]}
                          </span>
                        </span>
                        <span style={{ color: HOME_THEME.muted, letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                        <span style={{ textAlign: "center", color: HOME_THEME.muted }}>{r.accounts || "—"}</span>
                        <span style={{ textAlign: "right", fontWeight: 800, color: isIn ? HOME_THEME.green : SOFT_RED }}>{isIn ? "+" : "−"}{fmtMoney(isIn ? r.inAmt : r.outAmt, currency)}</span>
                        <span style={{ textAlign: "right" }}>
                          {r.id != null ? <DeleteButton onClick={() => onDelete(r.id!)} /> : <span title="Edit on the Payments tab" style={{ color: HOME_THEME.muted, opacity: 0.4, fontSize: 12 }}>↗</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {data.months.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 26px", padding: "12px 16px", borderTop: `1px solid ${HOME_THEME.border}`, background: HOME_THEME.panel, fontSize: 14, fontWeight: 900 }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.12em", color: HOME_THEME.muted, fontSize: 12 }}>{year} Total</span>
            <span style={{ textAlign: "right", color: HOME_THEME.green }}>{fmtMoney(data.totalIn, currency)}</span>
            <span style={{ textAlign: "right", color: SOFT_RED }}>{fmtMoney(data.totalOut, currency)}</span>
            <span style={{ textAlign: "right", color: data.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(data.net, currency)}</span>
            <span />
          </div>
        )}
      </div>

      {/* CB Edge — rolling month-by-month sales vs expenses (no day drill-down) */}
      {(() => {
        const cbedgeMonths = data.months
          .map((m) => {
            const rows = m.rows.filter((r) => r.stream === "cbedge");
            const inAmt = rows.reduce((s, r) => s + r.inAmt, 0);
            const outAmt = rows.reduce((s, r) => s + r.outAmt, 0);
            return { ym: m.ym, inAmt, outAmt, net: inAmt - outAmt };
          })
          .filter((m) => m.inAmt !== 0 || m.outAmt !== 0);
        const t = data.streams.cbedge;
        return (
          <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 16px", borderBottom: `1px solid ${HOME_THEME.border}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: HOME_THEME.cyan }} />
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>CB Edge · Monthly</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: HOME_THEME.muted }}>{year} · sales vs expenses</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "10px 16px", background: HOME_THEME.panel, fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.muted }}>
              <span>Month</span>
              <span style={{ textAlign: "right" }}>Sales</span>
              <span style={{ textAlign: "right" }}>Expenses</span>
              <span style={{ textAlign: "right" }}>Net</span>
            </div>
            {cbedgeMonths.length === 0 && (
              <div style={{ padding: "22px 16px", textAlign: "center", color: HOME_THEME.muted }}>No CB Edge activity in {year} yet.</div>
            )}
            {cbedgeMonths.map((m) => (
              <div key={m.ym} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "11px 16px", alignItems: "center", fontSize: 14, borderTop: `1px solid ${HOME_THEME.border}` }}>
                <span style={{ fontWeight: 800 }}>{monthName(m.ym)}</span>
                <span style={{ textAlign: "right", color: m.inAmt > 0 ? HOME_THEME.green : HOME_THEME.muted }}>{fmtMoney(m.inAmt, currency)}</span>
                <span style={{ textAlign: "right", color: m.outAmt > 0 ? SOFT_RED : HOME_THEME.muted }}>{fmtMoney(m.outAmt, currency)}</span>
                <span style={{ textAlign: "right", fontWeight: 900, color: m.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(m.net, currency)}</span>
              </div>
            ))}
            {cbedgeMonths.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "12px 16px", borderTop: `1px solid ${HOME_THEME.border}`, background: HOME_THEME.panel, fontSize: 14, fontWeight: 900 }}>
                <span style={{ textTransform: "uppercase", letterSpacing: "0.12em", color: HOME_THEME.muted, fontSize: 12 }}>{year} Total</span>
                <span style={{ textAlign: "right", color: HOME_THEME.green }}>{fmtMoney(t.inAmt, currency)}</span>
                <span style={{ textAlign: "right", color: SOFT_RED }}>{fmtMoney(t.outAmt, currency)}</span>
                <span style={{ textAlign: "right", color: t.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(t.net, currency)}</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function AmazonTable({ rows, currency, onDelete }: { rows: (AmazonRow & { net: number })[]; currency: string; onDelete: (id: number) => void }) {
  const totalPay = rows.reduce((s, r) => s + r.pay, 0);
  const totalGas = rows.reduce((s, r) => s + r.gas, 0);
  const totalNet = totalPay - totalGas;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ position: "sticky", top: 0, background: HOME_THEME.panel, backdropFilter: "blur(8px)", zIndex: 1 }}>
          <th style={th("left")}>Date</th>
          <th style={th("right")}>Pay</th>
          <th style={th("right")}>Gas</th>
          <th style={th("right")}>Net Pay</th>
          <th style={th("center")}></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={5} style={{ padding: "22px 16px", color: HOME_THEME.muted, textAlign: "center" }}>No Amazon days logged this month yet.</td></tr>
        )}
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: `1px solid ${HOME_THEME.border}` }}>
            <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 800 }}>{shortDate(r.work_date)}</span>
              <span style={{ color: HOME_THEME.muted, marginLeft: 8, fontSize: 14 }}>{weekday(r.work_date)}</span>
            </td>
            <td style={{ padding: "10px 16px", textAlign: "right" }}>{fmtMoney(r.pay, currency)}</td>
            <td style={{ padding: "10px 16px", textAlign: "right", color: HOME_THEME.orange }}>{fmtMoney(r.gas, currency)}</td>
            <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 900, color: r.net >= 0 ? HOME_THEME.green : SOFT_RED }}>{fmtMoney(r.net, currency)}</td>
            <td style={{ padding: "10px 12px", textAlign: "center" }}>
              <DeleteButton onClick={() => onDelete(r.id)} />
            </td>
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr style={{ position: "sticky", bottom: 0, background: HOME_THEME.panel, backdropFilter: "blur(8px)" }}>
            <td style={{ padding: "12px 16px", fontWeight: 900, textTransform: "uppercase", fontSize: 14, letterSpacing: "0.12em", color: HOME_THEME.muted }}>Total</td>
            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900 }}>{fmtMoney(totalPay, currency)}</td>
            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900, color: HOME_THEME.orange }}>{fmtMoney(totalGas, currency)}</td>
            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900, color: totalNet >= 0 ? HOME_THEME.green : SOFT_RED }}>{fmtMoney(totalNet, currency)}</td>
            <td />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// Inline-editable text (label).
function EditableText({ value, onCommit, style }: { value: string; onCommit: (v: string) => void; style?: React.CSSProperties }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        style={{ ...field(), padding: "4px 8px", fontSize: 14 }}
      />
    );
  }
  return <span onClick={() => setEditing(true)} style={{ ...style, cursor: "text", borderBottom: "1px dotted rgba(139,148,167,0.35)" }}>{value}</span>;
}

// Inline-editable signed money (amount). Shows the signed value, edits as a number.
function EditableMoney({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); const n = Number(draft); if (n !== value && draft.trim() !== "") onCommit(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
        style={{ ...field(), padding: "4px 8px", fontSize: 14, width: 100, textAlign: "right" }}
      />
    );
  }
  return <span onClick={() => setEditing(true)} style={{ cursor: "text" }}>{fmtMoney(value)}</span>;
}

function th(align: "left" | "right" | "center"): React.CSSProperties {
  return { textAlign: align, padding: "12px 16px", color: HOME_THEME.muted, fontWeight: 800, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.12em", borderBottom: `1px solid ${HOME_THEME.border}` };
}
// SOLID card surface — no gradients, no radial highlights, no backdrop blur.
// One flat dark panel + hairline edge is the whole visual language of this page.
function card(): React.CSSProperties {
  return {
    // Solid fill + a 1.5% white top wash (sheen, not glass) over the deep panel.
    background: `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 34%), ${PANEL}`,
    borderRadius: 16,
    border: `1px solid ${HAIRLINE}`,
    boxShadow: CARD_SHADOW,
  };
}
// hex → rgba for accent tints.
function bRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
const LIGHT_BLUE = "#7dd3fc";
// Both legacy surfaces now resolve to the same solid card.
function cardAccent(_i: number): React.CSSProperties {
  return card();
}
function dissolveCard(): React.CSSProperties {
  return card();
}
function field(): React.CSSProperties {
  return { padding: "10px 12px", borderRadius: 10, border: `1px solid ${HAIRLINE}`, background: "rgba(0,0,0,0.45)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.45)", transition: "border-color .15s ease, box-shadow .15s ease", color: HOME_THEME.text, outline: "none", width: "100%", fontSize: 14, colorScheme: "dark", accentColor: HOME_THEME.cyan, appearance: "none", WebkitAppearance: "none", MozAppearance: "textfield" as const };
}
function labelCap(): React.CSSProperties {
  return { fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, marginBottom: 6 };
}
function primary(): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(33,158,188,0.60)", background: "linear-gradient(180deg, rgba(33,158,188,0.30), rgba(33,158,188,0.08))", boxShadow: "0 0 24px rgba(33,158,188,0.40), inset 0 1px 0 rgba(255,255,255,0.12)", color: LIGHT_BLUE, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap", transition: "box-shadow .15s ease, border-color .15s ease" };
}
function ghost(): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 10, border: `1px solid ${HAIRLINE}`, background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)", color: HOME_THEME.text, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", transition: "border-color .15s ease, background .15s ease" };
}
function pill(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 999,
    border: active ? "1px solid rgba(33,158,188,0.75)" : `1px solid ${HAIRLINE}`,
    background: active ? "linear-gradient(180deg, rgba(33,158,188,0.30), rgba(33,158,188,0.10))" : "rgba(255,255,255,0.03)",
    boxShadow: active ? "0 0 22px rgba(33,158,188,0.50), inset 0 1px 0 rgba(255,255,255,0.10)" : "none",
    color: active ? HOME_THEME.cyan : "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    transition: "border-color .15s ease, box-shadow .15s ease, background .15s ease, color .15s ease",
  };
}
