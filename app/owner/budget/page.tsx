"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { ThemedMonthPicker } from "@/components/shared/ThemedMonthPicker";

// Clerk publishableKey isn't present at build time (mounted at runtime), so
// prerendering this page throws "Missing publishableKey". Render at request time.
export const dynamic = "force-dynamic";

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
  slices: { label: string; value: number; color: string }[];
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

export default function BudgetPage() {
  const [profile, setProfile] = useState<BudgetProfile | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [register, setRegister] = useState<RegisterRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringRule[]>([]);
  const [amazonRows, setAmazonRows] = useState<AmazonRow[]>([]);
  const [propRows, setPropRows] = useState<PropRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dailyBalance, setDailyBalance] = useState<DailyBalance | null>(null);
  const [prevDailyBalance, setPrevDailyBalance] = useState<DailyBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "register" | "categories" | "amazon" | "bzila" | "yearly">("overview");
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [yearRows, setYearRows] = useState<RegisterRow[]>([]);
  const [yearLoading, setYearLoading] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Overview: cash-flow bucket size + the right-hand panel's tab.
  const [cfMode, setCfMode] = useState<"daily" | "weekly" | "monthly">("daily");
  const [rightTab, setRightTab] = useState<"calendar" | "projection">("calendar");

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
      .map((c, i) => ({ label: c.name, value: categoryStats.spent[c.id] || 0, color: c.color || CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    if (categoryStats.unsortedTotal > 0) slices.push({ label: "Unsorted", value: categoryStats.unsortedTotal, color: "rgba(255,255,255,0.35)" });

    return { daysInMonth, todayDay, daysLeft, billsLeft, safe, safePerDay, cum, budgetTotal, paceNow, spentMtd, week, wkOut, prevWkOut, slices };
  }, [register, recurring, month, allBanks, categories, categoryStats, computed]);
  const prevAllBanks = prevDailyBalance ? prevDailyBalance.coastal + prevDailyBalance.truist + prevDailyBalance.secu : null;

  // Bzila net for the selected month (all three streams). Shown as its own tile
  // — deliberately NOT rolled into the Income / Net Profit tiles, which stay
  // personal-only.
  const bzilaMonth = useMemo(
    () => bzilaComputed.months.find((m) => m.ym === month) ?? { inAmt: 0, outAmt: 0, net: 0 },
    [bzilaComputed, month]
  );

  // Cash-flow buckets (in vs out) at day / week / month resolution.
  const cashflow = useMemo(() => {
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
  const deleteCategory = async (id: number) => post({ action: "categoryDelete", id });
  const assignCategory = async (rowId: number, categoryId: number | null) => post({ action: "assignCategory", id: rowId, categoryId });
  // Log an upcoming recurring bill as paid (materialize this occurrence).
  const markBillPaid = async (bill: { date: string; label: string; bank: Bank; amount: number; tag: string }) =>
    post({ action: "registerRow", date: bill.date, label: bill.label, bank: bill.bank, amount: bill.amount, recurringTag: bill.tag });
  // Daily opening balance (input each morning).
  const saveDailyBalance = async (day: string, coastal: number, truist: number, secu: number) =>
    post({ action: "dailyBalance", day, coastal, truist, secu });
  const saveBeginning = async (balances: Record<Bank, number>) =>
    post({ action: "setBeginning", month, balances });
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
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.28em", color: HOME_THEME.muted, opacity: 0.75 }}>{monthLabel.toUpperCase()}</div>
            <div style={{ fontSize: "clamp(26px, 3.2vw, 38px)", fontWeight: 900, letterSpacing: "0.16em", lineHeight: 1.1, marginTop: 4, textShadow: "0 0 34px rgba(125,211,252,0.55), 0 0 80px rgba(33,158,188,0.35)" }}>BUDGET</div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={labelCap()}>Month</div>
            <ThemedMonthPicker value={month} onChange={setMonth} width={180} onOpenChange={setMonthPickerOpen} />
          </div>
        </div>

        {/* Tabs (top-level nav) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {([["overview", "Overview"], ["register", "Payments"], ["categories", "Categories"], ["amazon", "Amazon"], ["bzila", "Bzila"], ["yearly", "Yearly"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={pill(tab === k)}>{l}</button>
          ))}
          {tab === "register" && (
            <button onClick={() => setShowRecurring((v) => !v)} style={{ ...pill(showRecurring), marginLeft: 4 }}>
              🔁 Recurring{recurring.length ? ` (${recurring.filter((r) => r.active).length})` : ""}
            </button>
          )}
          {loading && <span style={{ fontSize: 15, color: HOME_THEME.muted, marginLeft: 6 }}>Loading…</span>}
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
          <StatTile label="Income" value={fmtMoney(computed.income + amazonComputed.totalNet, currency)} sub={`${monthLabel.split(" ")[0]} inflows · incl. Amazon`} valueColor={HOME_THEME.green} />
          <StatTile label="Expenses" value={fmtMoney(Math.abs(computed.payments), currency)} sub={`${monthLabel.split(" ")[0]} outflows`} valueColor={SOFT_RED} />
          <StatTile label="Net Profit" value={fmtMoney(computed.netCashFlow + amazonComputed.totalNet, currency)} sub="Income − expenses" valueColor={computed.netCashFlow + amazonComputed.totalNet < 0 ? SOFT_RED : HOME_THEME.green} />
          <StatTile label="Amazon" value={fmtMoney(amazonComputed.totalNet, currency)} sub={`${amazonComputed.rows.length} day${amazonComputed.rows.length === 1 ? "" : "s"} · net of gas`} valueColor={amazonComputed.totalNet < 0 ? SOFT_RED : HOME_THEME.text} />
          <StatTile label="Bzila" value={fmtMoney(bzilaMonth.net, currency)} sub={`${fmtMoney(bzilaMonth.inAmt, currency)} in · ${fmtMoney(bzilaMonth.outAmt, currency)} out`} valueColor={bzilaMonth.net < 0 ? SOFT_RED : HOME_THEME.green} />
        </div>

        {/* Daily/weekly budgeting intelligence */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignItems: "stretch" }}>
          <SafeToSpendCard intel={intel} currency={currency} />
          <SpendPaceCard intel={intel} currency={currency} />
          <CategoryDonutCard slices={intel.slices} currency={currency} />
          <WeekPulseCard intel={intel} currency={currency} />
        </div>

        {/* Cash flow (D/W/M) + calendar / projection */}
        <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 12, alignItems: "stretch" }}>
          <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Cash Flow</div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6, marginTop: 2 }}>{cfMode === "monthly" ? String(year) : monthLabel}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.muted, opacity: 0.75 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: HOME_THEME.green }} /> In
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: SOFT_RED, marginLeft: 8 }} /> Out
                </span>
                <Segmented
                  value={cfMode}
                  onChange={(v) => setCfMode(v as "daily" | "weekly" | "monthly")}
                  options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]}
                />
              </div>
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
              <CalendarGrid month={month} groups={computed.groups} currency={currency} selected={selectedDate} onSelect={setSelectedDate} />
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
            spent={categoryStats.spent}
            unsortedCount={categoryStats.unsorted.length}
            unsortedTotal={categoryStats.unsortedTotal}
            currency={currency}
            onOpenCategories={() => setTab("categories")}
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
            <input type="date" value={ppDate} onChange={(e) => setPpDate(e.target.value)} style={field()} />
            <ThemedSelect
              value={ppSource}
              onChange={(v) => { setPpSource(v as PropSource); setPpFirm(PROP_SOURCE_UI[v as PropSource].defaultFirm); }}
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

function BeginningEditor({ beginningByBank, totals, onSave, currency }: { beginningByBank: Record<Bank, number | null>; totals: Record<Bank, number>; onSave: (balances: Record<Bank, number>) => void; currency: string }) {
  const [vals, setVals] = useState<Record<Bank, string>>({ coastal: "", truist: "", secu: "" });
  const [saved, setSaved] = useState(false);

  // Keep inputs in sync with the latest saved balances (without clobbering a
  // value the user is actively typing on first load).
  useEffect(() => {
    setVals({
      coastal: beginningByBank.coastal !== null ? String(beginningByBank.coastal) : "",
      truist: beginningByBank.truist !== null ? String(beginningByBank.truist) : "",
      secu: beginningByBank.secu !== null ? String(beginningByBank.secu) : "",
    });
  }, [beginningByBank.coastal, beginningByBank.truist, beginningByBank.secu]);

  const save = () => {
    onSave({ coastal: Number(vals.coastal || 0), truist: Number(vals.truist || 0), secu: Number(vals.secu || 0) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div>
      <div style={{ ...labelCap(), color: HOME_THEME.text, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start", marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🏦</span> Account balances
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "flex-start" }}>
        {BANKS.map((b) => (
          <div key={b} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.muted, letterSpacing: "0.1em" }}>{BANK_LABEL[b]}</span>
            {(() => {
              const shown = beginningByBank[b] ?? 0;
              return (
                <span style={{ fontSize: 15, fontWeight: 900, color: shown < 0 ? SOFT_RED : HOME_THEME.text, lineHeight: 1.1 }}>{fmtMoney(shown, currency)}</span>
              );
            })()}
            <input
              value={vals[b]}
              onChange={(e) => setVals((p) => ({ ...p, [b]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="set balance…"
              type="number"
              title="Set this account's balance"
              style={{ ...field(), width: 140, padding: "8px 12px", fontSize: 15 }}
            />
          </div>
        ))}
        <button onClick={save} style={{ ...primary(), alignSelf: "flex-end" }}>{saved ? "Saved ✓" : "Save"}</button>
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
          <div style={{ fontSize: 16, fontWeight: 900 }}>Recurring entries</div>
          <div style={{ fontSize: 15, color: HOME_THEME.muted, marginTop: 3 }}>Anything that repeats — they appear on every month&apos;s Payments automatically.</div>
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
                <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{FREQ_LABEL[rule.frequency]}</span>
                <span style={{ fontSize: 15, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{BANK_LABEL[rule.bank]}</span>
                <span style={{ fontWeight: 800, color: inc ? HOME_THEME.green : SOFT_RED }}>{inc ? "+" : ""}{fmtMoney(rule.amount, currency)}</span>
                <button
                  onClick={() => onUpdate(rule.id, { active: rule.active ? 0 : 1 })}
                  title={rule.active ? "Pause (hide from Payments)" : "Resume"}
                  style={{ ...ghost(), padding: "6px 10px", fontSize: 15 }}
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

// Monotone cubic (Fritsch–Carlson) → cubic-bezier. Smooth but guarantees NO
// overshoot: the curve never invents a hump or dip between data points, so it
// reads as an honest running balance instead of a wavy spline.
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return n ? `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}` : "";
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i] || 1e-6;
    dx.push(h);
    slope.push((ys[i + 1] - ys[i]) / h);
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else m[i] = (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * slope[i];
      m[i + 1] = tau * b * slope[i];
    }
  }
  let d = `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = xs[i] + dx[i] / 3;
    const c1y = ys[i] + (m[i] * dx[i]) / 3;
    const c2x = xs[i + 1] - dx[i] / 3;
    const c2y = ys[i + 1] - (m[i + 1] * dx[i]) / 3;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

// SVG line chart of the running combined balance across the month, with a
// hover guide + tooltip showing the exact date and balance under the cursor.
function ProjectionChart({ series, currency }: { series: { date: string; balance: number }[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) {
    return <div style={{ height: 240, display: "grid", placeItems: "center", color: HOME_THEME.muted, fontSize: 15 }}>Add entries to see the projection.</div>;
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
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.1em", color: HOME_THEME.muted }}>{shortDate(hp.date)}</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: hp.balance < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(hp.balance, currency)}</div>
        </div>
      )}
    </div>
  );
}

// Cashflow calendar grid: a month of days, each tinted + labelled with its net
// change (green surplus / red deficit). Clicking a day lifts the selection to
// the page so the transactions panel below can show that day.
function CalendarGrid({
  month,
  groups,
  currency,
  selected,
  onSelect,
}: {
  month: string;
  groups: DayGroup[];
  currency: string;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Sun
  const byDate = new Map(groups.map((g) => [g.date, g]));
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const todayStr = todayIso();
  const todayDay = todayStr.slice(0, 7) === month ? Number(todayStr.slice(8, 10)) : null;
  const WD = ["S", "M", "T", "W", "T", "F", "S"];
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
      {WD.map((w, i) => (
        <div key={i} style={{ textAlign: "center", fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.muted, padding: "2px 0 4px" }}>{w}</div>
      ))}
      {cells.map((d, i) => {
        if (d === null) return <div key={`e${i}`} />;
        const g = byDate.get(iso(d));
        const net = g?.dailyNet ?? 0;
        const isSel = selected === iso(d);
        const isToday = d === todayDay;
        const pos = net > 0, neg = net < 0;
        const tint = neg ? "rgba(244,148,142,0.10)" : pos ? "rgba(142,202,230,0.08)" : "rgba(255,255,255,0.02)";
        return (
          <button
            key={d}
            onClick={() => g && onSelect(iso(d))}
            disabled={!g}
            style={{
              textAlign: "left", minHeight: 56, padding: "6px 7px", borderRadius: 9, cursor: g ? "pointer" : "default",
              background: tint,
              border: `1px solid ${isSel ? "#7dd3fc" : isToday ? "rgba(255,255,255,0.6)" : g ? HOME_THEME.border : "transparent"}`,
              boxShadow: isSel ? "0 0 0 1px rgba(126,211,252,0.4)" : isToday ? "0 0 0 1px rgba(255,255,255,0.25)" : "none",
              color: HOME_THEME.text, transition: "all 0.12s ease",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: HOME_THEME.muted, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{d}</span>
            </div>
            {g && <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2, color: neg ? SOFT_RED : pos ? HOME_THEME.green : HOME_THEME.muted }}>{pos ? "+" : ""}{fmtMoney(net, currency)}</div>}
          </button>
        );
      })}
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
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.14em", color: "#7dd3fc" }}>STARTING BALANCE</span>
          <span style={{ fontWeight: 900, fontSize: 19, color: beginningBalance < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(beginningBalance, currency)}</span>
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
                <span style={{ fontWeight: 900, fontSize: 16 }}>{longDate(g.date)}</span>
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
    <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: map.color, background: map.bg, border: `1px solid ${map.border}`, padding: "2px 8px", borderRadius: 999 }}>
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
        fontSize: 15,
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
        fontSize: 16,
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
    <span onClick={() => setEditing(true)} title="Change date (e.g. paid early)" style={{ cursor: "text", fontSize: 15, fontWeight: 700, color: HOME_THEME.muted, borderBottom: "1px dotted rgba(139,148,167,0.35)", whiteSpace: "nowrap" }}>
      {shortDate(value)}
    </span>
  );
}

// ── Overview building blocks ─────────────────────────────────────────────────

/** Label/value row (legacy OverviewPanel below still uses it). */
function StatLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
      <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color }}>{value}</span>
    </div>
  );
}

/** Segmented tab control (Daily/Weekly/Monthly, Calendar/Projection). */
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
      <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>{title}</div>
      {right}
    </div>
  );
}

/** Safe-to-Spend: what's left per day after every bill still due this month. */
function SafeToSpendCard({ intel, currency }: { intel: Intel; currency: string }) {
  const neg = intel.safePerDay < 0;
  const pct = Math.min(100, Math.max(0, (intel.todayDay / intel.daysInMonth) * 100));
  return (
    <div style={{ ...card(), padding: 16, background: "#000000", border: `1px solid ${bRgba(LIGHT_BLUE, 0.6)}`, boxShadow: `${EDGE_LIGHT}, 0 0 36px -6px ${bRgba(LIGHT_BLUE, 0.55)}, 0 24px 60px -16px rgba(0,0,0,0.75)`, display: "flex", flexDirection: "column" }}>
      <IntelHeader title="Safe to Spend" />
      <div style={{ fontSize: 34, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: neg ? SOFT_RED : LIGHT_BLUE, textShadow: `0 0 30px ${bRgba(neg ? SOFT_RED : LIGHT_BLUE, 0.6)}` }}>
        {fmtMoney(intel.safePerDay, currency)}<span style={{ fontSize: 15, fontWeight: 800, opacity: 0.7 }}> /day</span>
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ opacity: 0.6 }}>Free this month</span><b style={{ color: intel.safe < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(intel.safe, currency)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ opacity: 0.6 }}>Bills still due</span><b style={{ color: SOFT_RED }}>{fmtMoney(intel.billsLeft, currency)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ opacity: 0.6 }}>Days left</span><b>{intel.daysLeft}</b></div>
      </div>
      <div style={{ marginTop: "auto", paddingTop: 12 }}>
        <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${HOME_THEME.cyan}, ${LIGHT_BLUE})`, boxShadow: `0 0 12px ${bRgba(LIGHT_BLUE, 0.6)}` }} />
        </div>
        <div style={{ marginTop: 5, fontSize: 11, opacity: 0.55 }}>Day {Math.max(intel.todayDay, 0)} of {intel.daysInMonth}</div>
      </div>
    </div>
  );
}

/** Spend Pace: cumulative month spend vs the straight-line budget pace. */
function SpendPaceCard({ intel, currency }: { intel: Intel; currency: string }) {
  const W = 300, H = 132;
  const maxV = Math.max(intel.budgetTotal, intel.cum[intel.cum.length - 1] || 0, 1);
  const px = (i: number) => (i / (intel.daysInMonth - 1)) * W;
  const py = (v: number) => H - (v / maxV) * (H - 10);
  const upTo = Math.max(1, Math.min(intel.todayDay, intel.daysInMonth));
  const actual = intel.cum.slice(0, upTo).map((v, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const area = `${actual} L ${px(upTo - 1).toFixed(1)} ${H} L 0 ${H} Z`;
  const over = intel.spentMtd > intel.paceNow;
  const delta = Math.abs(intel.spentMtd - intel.paceNow);
  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader
        title="Spend Pace"
        right={<span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 999, color: over ? SOFT_RED : HOME_THEME.green, background: bRgba(over ? SOFT_RED : HOME_THEME.green, 0.12), border: `1px solid ${bRgba(over ? SOFT_RED : HOME_THEME.green, 0.4)}`, boxShadow: `0 0 12px ${bRgba(over ? SOFT_RED : HOME_THEME.green, 0.25)}` }}>{over ? "OVER" : "UNDER"} {fmtMoney(delta, currency).replace(/\.\d+$/, "")}</span>}
      />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={over ? SOFT_RED : LIGHT_BLUE} stopOpacity={0.3} />
            <stop offset="100%" stopColor={over ? SOFT_RED : LIGHT_BLUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* budget pace line */}
        <line x1={0} y1={py(0)} x2={W} y2={py(intel.budgetTotal)} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 5" />
        <path d={area} fill="url(#paceFill)" />
        <path d={actual} fill="none" stroke={bRgba(over ? SOFT_RED : LIGHT_BLUE, 0.45)} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
        <path d={actual} fill="none" stroke={over ? SOFT_RED : LIGHT_BLUE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {upTo > 0 && <circle cx={px(upTo - 1)} cy={py(intel.cum[upTo - 1] || 0)} r={4} fill={over ? SOFT_RED : LIGHT_BLUE} stroke={INK} strokeWidth={1.5} />}
      </svg>
      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        <span style={{ opacity: 0.6 }}>Spent MTD <b style={{ color: HOME_THEME.text }}>{fmtMoney(intel.spentMtd, currency)}</b></span>
        <span style={{ opacity: 0.6 }}>Budget <b style={{ color: HOME_THEME.text }}>{fmtMoney(intel.budgetTotal, currency)}</b></span>
      </div>
    </div>
  );
}

/** Category donut — where the month's spend actually went. */
function CategoryDonutCard({ slices, currency }: { slices: Intel["slices"]; currency: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 44, C = 2 * Math.PI * R;
  let cumFrac = 0;
  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader title="Where It Went" />
      {total <= 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", opacity: 0.55, fontSize: 13 }}>No categorized spend yet.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 0 }}>
          <svg viewBox="0 0 120 120" width={128} height={128} style={{ flex: "none", filter: "drop-shadow(0 0 10px rgba(125,211,252,0.25))" }}>
            <circle cx={60} cy={60} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={16} />
            {slices.map((s, i) => {
              const frac = s.value / total;
              const el = (
                <circle key={i} cx={60} cy={60} r={R} fill="none" stroke={s.color} strokeWidth={16}
                  strokeDasharray={`${Math.max(frac * C - 1.5, 0.5)} ${C}`} strokeDashoffset={-cumFrac * C}
                  transform="rotate(-90 60 60)" strokeLinecap="butt" />
              );
              cumFrac += frac;
              return el;
            })}
            <text x={60} y={57} textAnchor="middle" fill={HOME_THEME.text} fontSize={15} fontWeight={900} style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(total, currency).replace(/\.\d+$/, "")}</text>
            <text x={60} y={72} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={9} fontWeight={800} letterSpacing="0.1em">SPENT</text>
          </svg>
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6, fontSize: 12, fontVariantNumeric: "tabular-nums", overflow: "hidden" }}>
            {slices.slice(0, 6).map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, boxShadow: `0 0 8px ${s.color}`, flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.8 }}>{s.label}</span>
                <b>{Math.round((s.value / total) * 100)}%</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 7-Day Pulse: daily net bars for the last week + spend vs the week before. */
function WeekPulseCard({ intel, currency }: { intel: Intel; currency: string }) {
  const maxAbs = Math.max(1, ...intel.week.map((d) => Math.abs(d.net)));
  const deltaPct = intel.prevWkOut > 0 ? ((intel.wkOut - intel.prevWkOut) / intel.prevWkOut) * 100 : null;
  const worse = (deltaPct ?? 0) > 0;
  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column" }}>
      <IntelHeader
        title="7-Day Pulse"
        right={deltaPct !== null ? (
          <span style={{ fontSize: 11, fontWeight: 900, padding: "3px 10px", borderRadius: 999, color: worse ? SOFT_RED : HOME_THEME.green, background: bRgba(worse ? SOFT_RED : HOME_THEME.green, 0.12), border: `1px solid ${bRgba(worse ? SOFT_RED : HOME_THEME.green, 0.4)}` }}>
            {worse ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}% vs prior wk
          </span>
        ) : undefined}
      />
      <div style={{ fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(intel.wkOut, currency)}<span style={{ fontSize: 12, fontWeight: 700, opacity: 0.55 }}> spent last 7 days</span></div>
      <div style={{ marginTop: 12, flex: 1, display: "flex", alignItems: "center", gap: 6, minHeight: 74 }}>
        {intel.week.map((d, i) => {
          const h = (Math.abs(d.net) / maxAbs) * 30;
          const up = d.net >= 0;
          const c = up ? HOME_THEME.green : SOFT_RED;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={`${d.date}: ${fmtMoney(d.net, currency)}`}>
              <div style={{ width: "100%", maxWidth: 22, height: 64, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 31, height: 2, background: "rgba(255,255,255,0.10)", borderRadius: 1 }} />
                <div style={{ position: "absolute", left: "15%", right: "15%", ...(up ? { bottom: 33, height: Math.max(h, d.net !== 0 ? 3 : 0) } : { top: 33, height: Math.max(h, d.net !== 0 ? 3 : 0) }), background: `linear-gradient(${up ? 180 : 0}deg, ${c}, ${bRgba(c, 0.4)})`, borderRadius: 3, boxShadow: d.net !== 0 ? `0 0 10px ${bRgba(c, 0.35)}` : "none" }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, opacity: i === 6 ? 1 : 0.45, color: i === 6 ? LIGHT_BLUE : HOME_THEME.text }}>{weekday(d.date)[0]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Grouped in/out bar chart for the cash-flow card. */
function CashFlowBars({ buckets, currency, beginningBalance = 0 }: { buckets: { label: string; inflow: number; outflow: number }[]; currency: string; beginningBalance?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!buckets.length) {
    return <div style={{ height: 260, display: "grid", placeItems: "center", color: HOME_THEME.muted, opacity: 0.6, fontSize: 13 }}>No cash flow this period yet.</div>;
  }
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.inflow, b.outflow)));
  const H = 240;
  const grid = [0, 0.5, 1];

  // Running-balance line = beginning balance + cumulative net (in − out) through
  // each bucket. Drawn as real dollars on its OWN right-hand axis (kept separate
  // so a large balance doesn't squash the daily-flow bars), with monotone
  // smoothing so the curve never overshoots into fake humps.
  let run = beginningBalance;
  const balances = buckets.map((b) => (run += b.inflow - b.outflow));
  const bMax = Math.max(...balances, beginningBalance);
  const bMin = Math.min(...balances, beginningBalance, 0);
  const bSpan = Math.max(bMax - bMin, 1);
  const padT = 12, padB = 8;
  const lineY = (v: number) => padT + (1 - (v - bMin) / bSpan) * (H - padT - padB);
  const lineX = (i: number) => (buckets.length === 1 ? 50 : ((i + 0.5) / buckets.length) * 100);
  const pts = balances.map((v, i) => [lineX(i), lineY(v)] as [number, number]);
  const linePath = monotonePath(pts);
  const areaPath = pts.length > 1 ? `${linePath} L ${pts[pts.length - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z` : "";
  const balTicks = [bMax, bMin + bSpan / 2, bMin];
  const showZero = bMin < 0;

  return (
    <div style={{ position: "relative", display: "flex", gap: 10 }}>
      {/* y axis */}
      <div style={{ width: 52, height: H, position: "relative", flex: "none" }}>
        {grid.map((g) => (
          <div key={g} style={{ position: "absolute", right: 6, top: (1 - g) * H - 7, fontSize: 11, color: HOME_THEME.muted, opacity: 0.5 }}>
            {g === 0 ? "0" : fmtMoney(max * g, currency).replace(/\.\d+$/, "")}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: "relative", height: H }}>
          {grid.map((g) => (
            <div key={g} style={{ position: "absolute", left: 0, right: 0, top: (1 - g) * H, borderTop: `1px dashed ${HOME_THEME.border}` }} />
          ))}
          <div style={{ position: "absolute", left: 0, right: 44, top: 0, bottom: 0 }}>
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
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.muted, opacity: 0.7 }}>{b.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.green }}>In {fmtMoney(b.inflow, currency)}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: SOFT_RED }}>Out {fmtMoney(b.outflow, currency)}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: LIGHT_BLUE, marginTop: 2, borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 3 }}>Bal {fmtMoney(balances[i], currency)}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Running-balance line overlay (real dollars, right axis) */}
            {pts.length > 1 && (
              <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
                <defs>
                  <linearGradient id="cfProjFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={LIGHT_BLUE} stopOpacity={0.38} />
                    <stop offset="100%" stopColor={LIGHT_BLUE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {showZero && <line x1={0} x2={100} y1={lineY(0)} y2={lineY(0)} stroke={bRgba(SOFT_RED, 0.4)} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
                <path d={areaPath} fill="url(#cfProjFill)" stroke="none" />
                {/* soft under-stroke = neon glow without an SVG filter */}
                <path d={linePath} fill="none" stroke={bRgba(LIGHT_BLUE, 0.45)} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <path d={linePath} fill="none" stroke={LIGHT_BLUE} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
          </div>
          {/* Right-hand balance axis (light blue = running balance in $) */}
          {pts.length > 1 && (
            <div style={{ position: "absolute", right: 0, top: 0, width: 42, height: H, pointerEvents: "none" }}>
              {balTicks.map((v, i) => (
                <div key={i} style={{ position: "absolute", right: 0, top: lineY(v) - 7, fontSize: 11, fontWeight: 700, color: LIGHT_BLUE, opacity: 0.7, whiteSpace: "nowrap" }}>
                  {fmtMoney(v, currency).replace(/\.\d+$/, "")}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, fontSize: 11, color: HOME_THEME.muted }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: HOME_THEME.green }} />In</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: SOFT_RED }} />Out</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 2, borderRadius: 2, background: LIGHT_BLUE }} />Running balance ($, right)</span>
        </div>
        <div style={{ display: "flex", gap: buckets.length > 20 ? 2 : 8, marginTop: 8, paddingRight: 44 }}>
          {buckets.map((b, i) => (
            <div key={`${b.label}-l-${i}`} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, color: HOME_THEME.muted, opacity: hover === i ? 1 : 0.5, overflow: "hidden", whiteSpace: "nowrap" }}>
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
        <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.6 }}>Due {shortDate(dueIso)} · the 5th</span>
      </div>

      {rentAmount === 0 ? (
        <div style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.7, padding: "8px 0" }}>
          Add a recurring payment with “Rent” in the label to track the countdown.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 42, fontWeight: 900, letterSpacing: "-0.02em", color: accent, lineHeight: 1 }}>
              {paid ? "Paid" : daysUntil === 0 ? "Today" : daysUntil}
            </span>
            {!paid && daysUntil > 0 && <span style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.muted }}>day{daysUntil === 1 ? "" : "s"} to rent</span>}
            {paid && <span style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.green }}>✓ this month</span>}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: HOME_THEME.muted, marginTop: 12 }}>
            <span>Rent</span>
            <span style={{ fontWeight: 800, color: HOME_THEME.text }}>{fmtMoney(rentAmount, currency)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: HOME_THEME.muted, marginTop: 4 }}>
            <span>On hand now</span>
            <span style={{ fontWeight: 800, color: available < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(available, currency)}</span>
          </div>

          {!paid && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${HOME_THEME.border}` }}>
              {/* What else lands before rent — e.g. both pay runs. */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.muted }}>
                <span>Coming in before then</span>
                <span style={{ color: incomingTotal > 0 ? HOME_THEME.green : HOME_THEME.muted }}>+{fmtMoney(incomingTotal, currency)}</span>
              </div>
              {incoming.length
                ? incoming.map((f, i) => flowLine(f, "in" + i, true))
                : <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.5, marginTop: 3 }}>Nothing scheduled</div>}

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.muted, marginTop: 10 }}>
                <span>Going out before then</span>
                <span style={{ color: outgoingTotal > 0 ? SOFT_RED : HOME_THEME.muted }}>{outgoingTotal > 0 ? "−" : ""}{fmtMoney(outgoingTotal, currency)}</span>
              </div>
              {outgoing.length
                ? outgoing.map((f, i) => flowLine(f, "out" + i, false))
                : <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.5, marginTop: 3 }}>Nothing scheduled</div>}

              {/* Cash on hand the moment rent is due. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text }}>Projected on the 5th</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: accent }}>{fmtMoney(projected, currency)}</span>
              </div>
            </div>
          )}

          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.07)", margin: "12px 0 6px", overflow: "hidden" }}>
            <div style={{ height: 8, borderRadius: 99, background: accent, width: `${pct}%`, transition: "width 0.2s ease" }} />
          </div>

          {paid ? (
            <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.green, marginTop: 6 }}>
              Rent is paid for this month.
            </div>
          ) : covered ? (
            <div style={{ marginTop: 8, borderRadius: 10, background: bRgba(HOME_THEME.green, 0.10), border: `1px solid ${bRgba(HOME_THEME.green, 0.3)}`, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.green }}>Enough coming in — rent's covered.</div>
              <div style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.8, marginTop: 2 }}>
                {fmtMoney(surplus, currency)} to spare after rent{daysUntil > 0 ? ` on the 5th` : ""}.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8, borderRadius: 10, background: bRgba(SOFT_RED, 0.10), border: `1px solid ${bRgba(SOFT_RED, 0.3)}`, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, color: HOME_THEME.muted }}>Still short by <span style={{ fontWeight: 800, color: SOFT_RED }}>{fmtMoney(shortfall, currency)}</span> after what's due{daysUntil > 0 ? ` in ${daysUntil} day${daysUntil === 1 ? "" : "s"}` : " today"}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: SOFT_RED, marginTop: 2 }}>
                {fmtMoney(perDay, currency)}<span style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.muted }}> /day extra</span>
              </div>
              <div style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.7, marginTop: 2 }}>
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
        <span style={{ fontSize: 11, color: isToday ? HOME_THEME.green : HOME_THEME.muted, opacity: isToday ? 1 : 0.55 }}>
          {value ? (isToday ? "updated today" : `as of ${shortDate(value.day)}`) : "not set today"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ORDER.map((b) => (
          <div key={b} style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${HOME_THEME.border}` }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.text }}>{BANK_LABEL[b]}</span>
            <input
              value={vals[b]}
              onChange={(e) => setVals((p) => ({ ...p, [b]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              type="number"
              placeholder="0"
              style={{ ...field(), padding: "7px 10px", fontSize: 13, textAlign: "right" }}
            />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 4px" }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>Total</span>
          <span style={{ fontSize: 18, fontWeight: 900, color: total < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(total, currency)}</span>
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
        <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.55 }}>{data.items.length} left</span>
      </div>

      {pastDue.length > 0 && (
        <div style={{ marginBottom: 12, borderRadius: 10, background: bRgba(HOME_THEME.red, 0.10), border: `1px solid ${bRgba(HOME_THEME.red, 0.3)}`, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "8px 12px" }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: SOFT_RED }}>{pastDue.length} Past due</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: SOFT_RED }}>{fmtMoney(pastDueTotal, currency)}</span>
          </div>
          {pastDue.map((b) => (
            <div key={b.tag} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "8px 12px", borderTop: `1px solid ${bRgba(HOME_THEME.red, 0.2)}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.label}
                <span style={{ fontSize: 11, color: HOME_THEME.muted, fontWeight: 600 }}> · {-b.days}d ago</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(Math.abs(b.amount), currency)}</span>
              <button onClick={() => onMarkPaid({ date: b.date, label: b.label, bank: b.bank, amount: b.amount, tag: b.tag })} style={{ ...ghost(), padding: "4px 8px", fontSize: 11, borderRadius: 8 }}>Pay</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.6 }}>Total due</span>
        <span style={{ fontSize: 22, fontWeight: 900, color: data.total > 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(data.total, currency)}</span>
      </div>
      {data.items.length === 0 ? (
        <div style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.6 }}>Nothing left to pay this month.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {data.items.slice(0, 5).map((b) => (
            <div key={b.tag} style={{ display: "grid", gridTemplateColumns: "48px 1fr auto auto", gap: 8, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${HOME_THEME.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.muted, opacity: 0.6 }}>{shortDate(b.date)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(Math.abs(b.amount), currency)}</span>
              <button onClick={() => onMarkPaid({ date: b.date, label: b.label, bank: b.bank, amount: b.amount, tag: b.tag })} style={{ ...ghost(), padding: "4px 8px", fontSize: 11, borderRadius: 8 }}>Pay</button>
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
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
                  <div style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.6, fontWeight: 600, letterSpacing: "0.06em" }}>{BANK_LABEL[r.bank]}</div>
                </td>
                <td style={{ padding: "11px 16px" }}>
                  {cat ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, color: cc, background: bRgba(cc, 0.10), border: `1px solid ${bRgba(cc, 0.3)}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: cc }} />
                      {cat.name}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, color: HOME_THEME.muted, background: bRgba("#ffffff", 0.04), border: `1px solid ${HOME_THEME.border}` }}>Unsorted</span>
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
}: {
  categories: Category[];
  spent: Record<number, number>;
  unsortedCount: number;
  unsortedTotal: number;
  currency: string;
  onOpenCategories: () => void;
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
            {fmtMoney(totalSpent, currency)} categorized this month
          </div>
        </div>
        <button onClick={onOpenCategories} style={{ ...ghost(), padding: "5px 10px", fontSize: 11, borderRadius: 8 }}>Manage</button>
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
          <span style={{ flex: 1, fontSize: 13 }}>
            {unsortedCount} unsorted transaction{unsortedCount === 1 ? "" : "s"} — {fmtMoney(unsortedTotal, currency)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.orange }}>Sort now →</span>
        </button>
      )}

      <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.length === 0 && (
          <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: HOME_THEME.muted, opacity: 0.6 }}>
            No categories yet — add them on the Categories tab.
          </div>
        )}
        {rows.map(({ c, s }) => {
          const budget = c.amount || 0;
          const pct = budget > 0 ? Math.min(100, (s / budget) * 100) : 0;
          const over = budget > 0 && s > budget;
          const cc = c.color || LIGHT_BLUE;
          return (
            <div key={c.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: cc, flex: "none" }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{c.name}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: over ? SOFT_RED : HOME_THEME.text }}>
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

// Manually-entered opening balance, updated each morning. Sums the three banks.
function DailyOpeningBalanceCard({
  value,
  prevValue,
  currency,
  onSave,
}: {
  value: DailyBalance | null;
  prevValue: DailyBalance | null;
  currency: string;
  onSave: (day: string, coastal: number, truist: number, secu: number) => void;
}) {
  const [c, setC] = useState(value ? String(value.coastal) : "");
  const [t, setT] = useState(value ? String(value.truist) : "");
  const [s, setS] = useState(value ? String(value.secu) : "");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (value) {
      setC(String(value.coastal));
      setT(String(value.truist));
      setS(String(value.secu));
    }
  }, [value?.coastal, value?.truist, value?.secu]);
  const sum = (Number(c) || 0) + (Number(t) || 0) + (Number(s) || 0);
  const today = todayIso();
  const isToday = value?.day === today;
  const save = () => {
    onSave(today, Number(c) || 0, Number(t) || 0, Number(s) || 0);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // Day-over-day delta: today's entered balance vs. the last saved balance.
  // A drop means bills/payments went out since then; a rise means money came in.
  const prevSum = prevValue ? prevValue.coastal + prevValue.truist + prevValue.secu : null;
  const diff = prevSum !== null ? sum - prevSum : null;

  return (
    <div style={{ ...dissolveCard(), padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <div style={labelCap()}>Daily opening balance</div>
        {value && <span style={{ fontSize: 15, color: isToday ? HOME_THEME.green : HOME_THEME.muted }}>{isToday ? "updated today" : `as of ${shortDate(value.day)}`}</span>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 900, color: sum < 0 ? SOFT_RED : HOME_THEME.text }}>{fmtMoney(sum, currency)}</div>
      {diff !== null && prevValue && (
        <div style={{ fontSize: 15, fontWeight: 700, color: diff < 0 ? SOFT_RED : diff > 0 ? HOME_THEME.green : HOME_THEME.muted, marginTop: 2 }}>
          {diff === 0 ? "No change" : `${diff > 0 ? "+" : ""}${fmtMoney(diff, currency)}`} vs {shortDate(prevValue.day)}
          {diff !== 0 && <span style={{ color: HOME_THEME.muted, fontWeight: 500 }}> ({diff < 0 ? "bills out" : "payment in"})</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
        {([["COASTAL", c, setC], ["TRUIST", t, setT], ["SECU", s, setS]] as const).map(([lab, val, setter]) => (
          <div key={lab}>
            <div style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.muted, letterSpacing: "0.1em", marginBottom: 4 }}>{lab}</div>
            <input value={val} onChange={(e) => setter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} type="number" placeholder="0" style={{ ...field(), padding: "8px 10px" }} />
          </div>
        ))}
      </div>
      <button onClick={save} style={{ ...primary(), marginTop: 10, width: "100%" }}>{saved ? "Saved ✓" : "Save opening balance"}</button>
    </div>
  );
}

function OverviewPanel({
  safeToSpend,
  income,
  out,
  projected,
  billsDue,
  dailyBalance,
  prevDailyBalance,
  onSaveDaily,
  currency,
  onMarkPaid,
}: {
  safeToSpend: number;
  income: number;
  out: number;
  projected: number;
  billsDue: { label: string; amount: number; date: string; days: number; tag: string; bank: Bank }[];
  dailyBalance: DailyBalance | null;
  prevDailyBalance: DailyBalance | null;
  onSaveDaily: (day: string, coastal: number, truist: number, secu: number) => void;
  currency: string;
  onMarkPaid: (bill: { date: string; label: string; bank: Bank; amount: number; tag: string }) => void;
}) {
  const ratio = income > 0 ? Math.min(100, (out / income) * 100) : 0;
  const good = safeToSpend >= 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 14, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...dissolveCard(), padding: 18 }}>
          <div style={labelCap()}>Safe to spend this month</div>
          <div style={{ fontSize: 42, fontWeight: 900, color: good ? HOME_THEME.cyan : SOFT_RED, letterSpacing: "-0.01em", marginTop: 4 }}>{fmtMoney(safeToSpend, currency)}</div>
          <div style={{ fontSize: 15, color: HOME_THEME.muted, marginTop: 4 }}>{good ? "You're good. You've got this." : "You're over budget this month."}</div>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.07)", margin: "14px 0 6px" }}>
            <div style={{ height: 8, borderRadius: 99, background: HOME_THEME.cyan, width: `${ratio}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: HOME_THEME.muted }}>
            <span>Out {fmtMoney(out, currency)}</span>
            <span>of {fmtMoney(income, currency)} in</span>
          </div>
          <div style={{ marginTop: 14, fontSize: 15, color: HOME_THEME.muted }}>Projected end balance <span style={{ color: projected < 0 ? SOFT_RED : HOME_THEME.text, fontWeight: 800 }}>{fmtMoney(projected, currency)}</span></div>
        </div>

        <DailyOpeningBalanceCard value={dailyBalance} prevValue={prevDailyBalance} currency={currency} onSave={onSaveDaily} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...dissolveCard(), padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 10 }}>This period</div>
          <StatLine label="Money in" value={fmtMoney(income, currency)} color={HOME_THEME.green} />
          <StatLine label="Money out" value={fmtMoney(out, currency)} color={SOFT_RED} />
          <StatLine label="Bills due" value={String(billsDue.length)} color={HOME_THEME.text} />
        </div>

        {billsDue.length > 0 && (
          <div style={{ ...dissolveCard(), padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: SOFT_RED, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Bills due</div>
            {billsDue.map((b) => (
              <div key={b.tag} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.cyan }}>{b.label}</div>
                  <div style={{ fontSize: 15, fontWeight: b.days < 0 ? 800 : 400, color: b.days < 0 ? SOFT_RED : HOME_THEME.muted, opacity: b.days < 0 ? 1 : 0.7 }}>{b.days < 0 ? `Past due · ${-b.days} day${b.days === -1 ? "" : "s"} ago` : b.days === 0 ? "Due today" : `Due in ${b.days} day${b.days === 1 ? "" : "s"}`}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(Math.abs(b.amount), currency)}</span>
                  <button onClick={() => onMarkPaid({ date: b.date, label: b.label, bank: b.bank, amount: b.amount, tag: b.tag })} style={{ ...ghost(), padding: "6px 10px", fontSize: 15 }}>Mark paid</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
  onAssign: (rowId: number, categoryId: number | null) => void;
  onDeleteRow: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [openCat, setOpenCat] = useState<Category | null>(null);

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
        <div style={{ fontSize: 16, fontWeight: 900 }}>Categories</div>
        <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{categories.length} categor{categories.length === 1 ? "y" : "ies"}</span>
      </div>

      {unsorted.length > 0 && (
        <div style={{ borderRadius: 12, border: `1px dashed ${bRgba("#7dd3fc", 0.3)}`, background: bRgba("#7dd3fc", 0.05), padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>🧠 Brain dump — to sort</div>
              <div style={{ fontSize: 15, color: HOME_THEME.muted }}>Give each one a home</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: SOFT_RED }}>{fmtMoney(unsortedTotal, currency)}</div>
              <div style={{ fontSize: 15, color: HOME_THEME.muted }}>{unsorted.length} item{unsorted.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {unsorted.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 150px 90px", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{shortDate(r.entry_date)}</span>
                <span style={{ fontSize: 15, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                <ThemedSelect value="" onChange={(v) => onAssign(r.id, v ? Number(v) : null)} options={catOptions} />
                <span style={{ fontSize: 15, fontWeight: 800, color: SOFT_RED, textAlign: "right" }}>{fmtMoney(r.amount, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {categories.length === 0 && <div style={{ fontSize: 15, color: HOME_THEME.muted, padding: "6px 2px" }}>No categories yet — add one below to start budgeting.</div>}
        {categories.map((c) => {
          const s = spent[c.id] || 0;
          const budgetAmt = c.amount || 0;
          const left = budgetAmt - s;
          const pct = budgetAmt > 0 ? Math.min(100, (s / budgetAmt) * 100) : 0;
          const over = budgetAmt > 0 && s > budgetAmt;
          const dot = c.color || HOME_THEME.cyan;
          const count = (byCategory[c.id] || []).length;
          return (
            <div key={c.id} onClick={() => setOpenCat(c)} title="View transactions in this category" style={{ ...card(), padding: 12, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, minWidth: 0 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: dot, flex: "none" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  {count > 0 && <span style={{ fontSize: 15, color: HOME_THEME.muted, flex: "none" }}>· {count}</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                  <span style={{ fontSize: 15, color: HOME_THEME.text }}>{fmtMoney(s, currency)} <span style={{ color: HOME_THEME.muted }}>/ {budgetAmt > 0 ? fmtMoney(budgetAmt, currency) : "—"}</span></span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}><DeleteButton onClick={() => onDelete(c.id)} /></span>
                </span>
              </div>
              {budgetAmt > 0 ? (
                <>
                  <div style={{ height: 5, borderRadius: 99, background: "rgba(255,255,255,0.06)", marginBottom: 6 }}>
                    <div style={{ height: 5, borderRadius: 99, background: over ? SOFT_RED : dot, width: `${pct}%` }} />
                  </div>
                  <div style={{ fontSize: 15, color: over ? SOFT_RED : HOME_THEME.muted }}>{over ? `${fmtMoney(-left, currency)} over` : `${fmtMoney(left, currency)} left`}</div>
                </>
              ) : (
                <div style={{ fontSize: 15, color: HOME_THEME.muted }}>No budget — just tracking</div>
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
          <div onClick={(e) => e.stopPropagation()} style={{ ...card(), width: 520, maxWidth: "100%", maxHeight: "80vh", overflow: "auto", padding: 0, background: HOME_THEME.panel }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, position: "sticky", top: 0, background: HOME_THEME.panel, zIndex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: openCat.color || HOME_THEME.cyan, flex: "none" }} />
                <span style={{ fontSize: 16, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{openCat.name}</span>
                <span style={{ fontSize: 15, color: HOME_THEME.muted, flex: "none" }}>{fmtMoney(spent[openCat.id] || 0, currency)} spent</span>
              </div>
              <button onClick={() => setOpenCat(null)} style={{ ...ghost(), padding: "6px 12px" }}>Close</button>
            </div>
            <div style={{ padding: 12 }}>
              {(byCategory[openCat.id] || []).length === 0 ? (
                <div style={{ padding: "24px 12px", textAlign: "center", color: HOME_THEME.muted, fontSize: 15 }}>No transactions in this category yet.</div>
              ) : (
                (byCategory[openCat.id] || []).map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr auto auto", gap: 10, alignItems: "center", padding: "8px 6px", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
                    <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{shortDate(r.entry_date)}</span>
                    <span style={{ fontSize: 15, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: SOFT_RED, textAlign: "right", minWidth: 90 }}>{fmtMoney(r.amount, currency)}</span>
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

// Paste a screenshot of transactions → vision parse → review/categorize →
// bulk-insert as register rows. Nothing saves until the user hits Import.
type ParsedRow = { date: string; description: string; amount: number; direction: string };
type DraftRow = { include: boolean; date: string; description: string; label: string; bank: Bank; sign: "-" | "+"; amount: string };

function ImportPanel({
  onImport,
  onClose,
}: {
  onImport: (rows: { date: string; label: string; bank: Bank; amount: number }[]) => Promise<void>;
  onClose: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const parse = async (base64: string, mediaType: string) => {
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      const res = await fetch("/api/budget/parse-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Could not read that image.");
        return;
      }
      const parsed: ParsedRow[] = Array.isArray(data?.rows) ? data.rows : [];
      if (parsed.length === 0) {
        setError("No transactions found — try a clearer, tighter screenshot.");
        return;
      }
      setRows(
        parsed.map((r) => ({
          include: true,
          date: r.date,
          description: r.description,
          label: r.description.trim().toUpperCase().slice(0, 24),
          bank: "secu" as Bank,
          sign: r.direction === "in" ? "+" : "-",
          amount: String(r.amount),
        }))
      );
    } catch {
      setError("Parse failed — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
      if (!m) {
        setError("Unsupported image.");
        return;
      }
      setImage(dataUrl);
      void parse(m[2], m[1]);
    };
    reader.readAsDataURL(file);
  };

  // Catch a pasted image anywhere while the panel is open. Only acts on image
  // data, so pasting text into the label inputs is unaffected.
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const img = items.find((it) => it.type.startsWith("image/"));
      if (img) {
        const f = img.getAsFile();
        if (f) {
          e.preventDefault();
          readFile(f);
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRow = (i: number, patch: Partial<DraftRow>) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));

  const selected = rows.filter((r) => r.include && r.label.trim() && r.amount.trim() !== "" && Number(r.amount) !== 0);
  const doImport = async () => {
    if (!selected.length || importing) return;
    setImporting(true);
    try {
      await onImport(
        selected.map((r) => ({
          date: r.date,
          label: r.label.trim().toUpperCase(),
          bank: r.bank,
          amount: (r.sign === "-" ? -1 : 1) * Math.abs(Number(r.amount)),
        }))
      );
      onClose();
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ ...card(), padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>📋 Import from screenshot</div>
          <div style={{ fontSize: 15, color: HOME_THEME.muted, marginTop: 3 }}>Paste a screenshot of your transactions (⌘/Ctrl+V), then set the bank and label for each and import.</div>
        </div>
        <button onClick={onClose} style={ghost()}>Done</button>
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        style={{ display: "flex", alignItems: "center", gap: 12, border: `1px dashed ${bRgba("#7dd3fc", 0.35)}`, background: bRgba("#7dd3fc", 0.05), borderRadius: 12, padding: 12, cursor: "pointer", outline: "none" }}
      >
        {image ? (
          <img src={image} alt="pasted screenshot" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: `1px solid ${HOME_THEME.border}` }} />
        ) : (
          <span style={{ width: 44, height: 44, borderRadius: 9, background: bRgba("#7dd3fc", 0.12), display: "inline-flex", alignItems: "center", justifyContent: "center", color: HOME_THEME.cyan, fontSize: 15 }}>🖼️</span>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text }}>
            {loading ? "Reading transactions…" : image ? (error ? "Try another screenshot" : `Parsed ${rows.length} row${rows.length === 1 ? "" : "s"}`) : "Paste a screenshot (⌘/Ctrl+V) — or click to choose a file"}
          </div>
          {error && <div style={{ fontSize: 15, color: SOFT_RED, marginTop: 2 }}>{error}</div>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }} style={ghost()}>Choose file</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "22px 130px 1fr 110px 110px 110px 30px", gap: 8, alignItems: "center", background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, padding: "8px 10px", opacity: r.include ? 1 : 0.45 }}>
              <input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} style={{ accentColor: HOME_THEME.cyan, width: 16, height: 16 }} />
              <input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} style={{ ...field(), padding: "6px 8px", fontSize: 15 }} />
              <input value={r.label} onChange={(e) => setRow(i, { label: e.target.value.toUpperCase() })} title={r.description} placeholder={r.description} style={{ ...field(), padding: "6px 8px", fontSize: 15 }} />
              <ThemedSelect value={r.bank} onChange={(v) => setRow(i, { bank: v as Bank })} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} />
              <ThemedSelect value={r.sign} onChange={(v) => setRow(i, { sign: v as "-" | "+" })} options={[{ value: "-", label: "− Pay" }, { value: "+", label: "+ Income" }]} />
              <input value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} type="number" style={{ ...field(), padding: "6px 8px", fontSize: 15, textAlign: "right", color: r.sign === "-" ? SOFT_RED : HOME_THEME.green }} />
              <DeleteButton onClick={() => removeRow(i)} />
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 12 }}>
          <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{rows.length} found · {selected.length} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={ghost()}>Cancel</button>
            <button onClick={doImport} style={{ ...primary(), opacity: selected.length > 0 && !importing ? 1 : 0.5 }}>{importing ? "Importing…" : `Import ${selected.length} row${selected.length === 1 ? "" : "s"}`}</button>
          </div>
        </div>
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
        <div style={{ fontSize: 16, fontWeight: 900 }}>{year} — Year dashboard</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => onYear(year - 1)} style={{ ...ghost(), padding: "6px 12px" }}>◀</button>
          <span style={{ fontSize: 16, fontWeight: 900, minWidth: 56, textAlign: "center" }}>{year}</span>
          <button onClick={() => onYear(year + 1)} style={{ ...ghost(), padding: "6px 12px" }}>▶</button>
          {loading && <span style={{ fontSize: 15, color: HOME_THEME.muted, marginLeft: 6 }}>Loading…</span>}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ ...dissolveCard(), padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{c.icon}</span>
              <span style={labelCap()}>{c.label}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 15, fontWeight: 900, color: c.color }}>{fmtMoney(c.value, currency)}</div>
          </div>
        ))}
      </div>

      {/* Cash flow bar chart */}
      <div style={{ ...dissolveCard(), padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted }}>CASH FLOW</div>
          <div style={{ display: "flex", gap: 14, fontSize: 15, color: HOME_THEME.muted }}>
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
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>SPENDING BREAKDOWN</div>
          {donutTotal <= 0 ? (
            <div style={{ padding: "24px 0", color: HOME_THEME.muted, fontSize: 15 }}>No categorized spending this year yet.</div>
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
                      <span style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                    </span>
                    <span style={{ fontSize: 15, color: HOME_THEME.muted, flex: "none" }}>{Math.round((s.amount / donutTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ ...dissolveCard(), padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>BUDGET OVERVIEW</div>
          {budgeted.length === 0 ? (
            <div style={{ padding: "24px 0", color: HOME_THEME.muted, fontSize: 15 }}>No category budgets set.</div>
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
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: dot }} />{c.name}
                      </span>
                      <span style={{ fontSize: 15, color: HOME_THEME.muted }}>{fmtMoney(spent, currency)} <span style={{ opacity: 0.6 }}>/ {fmtMoney(annual, currency)}</span></span>
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
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>YEAR OVERVIEW</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
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
              <td style={{ padding: 12, fontWeight: 900, textTransform: "uppercase", fontSize: 15, letterSpacing: "0.1em", color: HOME_THEME.muted }}>Total</td>
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: HOME_THEME.muted }}>
                <span>In</span><span style={{ fontWeight: 800, color: HOME_THEME.green }}>{fmtMoney(t.inAmt, currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: HOME_THEME.muted, marginTop: 3 }}>
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

      {/* Monthly ledger */}
      <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
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
                style={{ width: "100%", textAlign: "left", cursor: "pointer", background: isOpen ? "rgba(255,255,255,0.03)" : "transparent", border: "none", color: HOME_THEME.text, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 26px", padding: "12px 16px", alignItems: "center", fontSize: 15 }}
              >
                <span style={{ fontWeight: 800 }}>{monthName(m.ym)}</span>
                <span style={{ textAlign: "right", color: m.inAmt > 0 ? HOME_THEME.green : HOME_THEME.muted }}>{fmtMoney(m.inAmt, currency)}</span>
                <span style={{ textAlign: "right", color: m.outAmt > 0 ? SOFT_RED : HOME_THEME.muted }}>{fmtMoney(m.outAmt, currency)}</span>
                <span style={{ textAlign: "right", fontWeight: 900, color: m.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(m.net, currency)}</span>
                <span style={{ textAlign: "right", color: HOME_THEME.muted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>›</span>
              </button>

              {isOpen && (
                <div style={{ background: "rgba(0,0,0,0.18)", borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "0.9fr 0.8fr 1.3fr 0.5fr 1fr 26px", padding: "7px 16px 7px 30px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>
                    <span>Date</span><span>Stream</span><span>Item</span><span style={{ textAlign: "center" }}>Accts</span><span style={{ textAlign: "right" }}>Amount</span><span />
                  </div>
                  {m.rows.map((r) => {
                    const isIn = r.inAmt > 0;
                    const c = STREAM_COLOR[r.stream];
                    return (
                      <div key={r.key} style={{ display: "grid", gridTemplateColumns: "0.9fr 0.8fr 1.3fr 0.5fr 1fr 26px", padding: "9px 16px 9px 30px", alignItems: "center", fontSize: 14, borderTop: `1px solid ${bRgba("#ffffff", 0.05)}` }}>
                        <span style={{ fontWeight: 700 }}>{shortDate(r.date)} <span style={{ color: HOME_THEME.muted, fontWeight: 400 }}>{weekday(r.date)}</span></span>
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
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 26px", padding: "12px 16px", borderTop: `1px solid ${HOME_THEME.border}`, background: HOME_THEME.panel, fontSize: 15, fontWeight: 900 }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.12em", color: HOME_THEME.muted, fontSize: 12 }}>{year} Total</span>
            <span style={{ textAlign: "right", color: HOME_THEME.green }}>{fmtMoney(data.totalIn, currency)}</span>
            <span style={{ textAlign: "right", color: SOFT_RED }}>{fmtMoney(data.totalOut, currency)}</span>
            <span style={{ textAlign: "right", color: data.net < 0 ? SOFT_RED : HOME_THEME.green }}>{fmtMoney(data.net, currency)}</span>
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function AmazonTable({ rows, currency, onDelete }: { rows: (AmazonRow & { net: number })[]; currency: string; onDelete: (id: number) => void }) {
  const totalPay = rows.reduce((s, r) => s + r.pay, 0);
  const totalGas = rows.reduce((s, r) => s + r.gas, 0);
  const totalNet = totalPay - totalGas;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
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
              <span style={{ color: HOME_THEME.muted, marginLeft: 8, fontSize: 15 }}>{weekday(r.work_date)}</span>
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
            <td style={{ padding: "12px 16px", fontWeight: 900, textTransform: "uppercase", fontSize: 15, letterSpacing: "0.12em", color: HOME_THEME.muted }}>Total</td>
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
        style={{ ...field(), padding: "4px 8px", fontSize: 15 }}
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
        style={{ ...field(), padding: "4px 8px", fontSize: 15, width: 100, textAlign: "right" }}
      />
    );
  }
  return <span onClick={() => setEditing(true)} style={{ cursor: "text" }}>{fmtMoney(value)}</span>;
}

function th(align: "left" | "right" | "center"): React.CSSProperties {
  return { textAlign: align, padding: "12px 16px", color: HOME_THEME.muted, fontWeight: 800, fontSize: 15, textTransform: "uppercase", letterSpacing: "0.12em", borderBottom: `1px solid ${HOME_THEME.border}` };
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
  return { padding: "10px 12px", borderRadius: 10, border: `1px solid ${HAIRLINE}`, background: "rgba(0,0,0,0.45)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.45)", transition: "border-color .15s ease, box-shadow .15s ease", color: HOME_THEME.text, outline: "none", width: "100%", fontSize: 15, colorScheme: "dark", accentColor: HOME_THEME.cyan, appearance: "none", WebkitAppearance: "none", MozAppearance: "textfield" as const };
}
function labelCap(): React.CSSProperties {
  return { fontSize: 15, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, marginBottom: 6 };
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
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    transition: "border-color .15s ease, box-shadow .15s ease, background .15s ease, color .15s ease",
  };
}
