"use client";

import { useEffect, useMemo, useState } from "react";
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
};
type AmazonRow = { id: number; work_date: string; pay: number; gas: number };
type Frequency = "weekly" | "biweekly" | "monthly";
type RecurringRule = { id: number; label: string; bank: Bank; amount: number; frequency: Frequency; anchor_date: string; active: number };

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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"register" | "amazon">("register");
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

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

  const currency = profile?.currency || "USD";

  const refresh = async (m = month) => {
    setLoading(true);
    const res = await fetch(`/api/budget?month=${m}`, { cache: "no-store" });
    const data = await res.json();
    setProfile(data.profile);
    setRegister(data.register || []);
    setRecurring(data.recurring || []);
    setAmazonRows(data.amazonRows || []);
    setLoading(false);
  };

  useEffect(() => {
    void refresh(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

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
    type Line = { id: number; entry_date: string; sort_order: number; label: string; bank: Bank; amount: number; recurring: boolean };
    const lines: Line[] = register
      .filter((r) => !r.is_beginning)
      .map((r) => ({ id: r.id, entry_date: r.entry_date, sort_order: r.sort_order, label: r.label, bank: r.bank, amount: r.amount, recurring: false }));

    // Recurring occurrences for this month (synthetic negative ids per rule+date).
    for (const rule of recurring) {
      if (!rule.active) continue;
      for (const date of occurrencesInMonth(rule, month)) {
        lines.push({ id: -(rule.id * 100 + Number(date.split("-")[2])), entry_date: date, sort_order: 40, label: rule.label, bank: rule.bank, amount: rule.amount, recurring: true });
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
      rows.push({ id: ln.id, entry_date: ln.entry_date, label: ln.label, bank: ln.bank, amount: ln.amount, is_beginning: 0, recurring: ln.recurring, balance: running, balances: { ...bal }, total: bal.coastal + bal.truist + bal.secu });
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

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow, color: HOME_THEME.text, fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px, 2vw, 24px)", gap: 14 }}>
        {/* Title banner */}
        <div style={{ ...cardAccent(4), padding: 0, overflow: "visible", position: "relative", zIndex: monthPickerOpen ? 80 : "auto" }}>
          <div style={{ textAlign: "center", padding: "14px 18px 6px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.2em", color: HOME_THEME.muted }}>{monthLabel.toUpperCase()}</div>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: "0.18em", marginTop: 2 }}>BUDGET</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", padding: "12px 18px 16px", borderTop: `1px solid ${HOME_THEME.border}` }}>
            <div>
              <div style={labelCap()}>Month</div>
              <ThemedMonthPicker value={month} onChange={setMonth} width={180} onOpenChange={setMonthPickerOpen} />
            </div>
            <BeginningEditor beginningByBank={computed.beginningByBank} totals={computed.totals} onSave={saveBeginning} currency={currency} />
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          {[
            { label: "Projected Balance", value: computed.projectedBalance, color: computed.projectedBalance < 0 ? HOME_THEME.red : HOME_THEME.purple, icon: "📊" },
            { label: "Total Inflows", value: computed.income, color: HOME_THEME.green, icon: "📈" },
            { label: "Total Outflows", value: Math.abs(computed.payments), color: HOME_THEME.red, icon: "📉" },
            { label: "Net Cash Flow", value: computed.netCashFlow, color: computed.netCashFlow < 0 ? HOME_THEME.red : HOME_THEME.green, icon: "💵" },
          ].map((t) => (
            <div key={t.label} style={{ ...card(), padding: 16, borderTop: `2px solid ${bRgba(t.color, 0.85)}`, background: `radial-gradient(circle at 50% 0%, ${bRgba(t.color, 0.16)} 0%, transparent 62%), ${HOME_THEME.panelBg}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span>
                <span style={labelCap()}>{t.label}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900, color: t.color }}>{fmtMoney(t.value, currency)}</div>
            </div>
          ))}
        </div>

        {/* Projection chart + top expenses */}
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>
          <div style={{ ...cardAccent(0), padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>BALANCE PROJECTION</div>
            <ProjectionChart series={computed.series} currency={currency} />
          </div>
          <div style={{ ...cardAccent(1), padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.muted, marginBottom: 10 }}>TOP EXPENSES</div>
            <TopExpenses items={computed.topExpenses} currency={currency} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {([["register", "Payments"], ["amazon", "Amazon"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={pill(tab === k)}>{l}</button>
          ))}
          {tab === "register" && (
            <button onClick={() => setShowRecurring((v) => !v)} style={{ ...pill(showRecurring), marginLeft: 4 }}>
              🔁 Recurring{recurring.length ? ` (${recurring.filter((r) => r.active).length})` : ""}
            </button>
          )}
          {loading && <span style={{ fontSize: 12, color: HOME_THEME.muted, marginLeft: 6 }}>Loading…</span>}
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

        {/* Content */}
        <div style={{ ...cardAccent(2), flex: 1, minHeight: 0, overflow: "visible", padding: 0 }}>
          {tab === "register" ? (
            <GroupedRegister groups={computed.groups} beginningBalance={computed.anyBeginning ? computed.beginningBalance : null} currency={currency} onEdit={editRow} onDelete={deleteRow} />
          ) : (
            <AmazonTable rows={amazonComputed.rows} currency={currency} onDelete={deleteAz} />
          )}
        </div>

        {/* Composer */}
        {tab === "register" ? (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "140px 1fr 130px 120px 130px 110px", gap: 10, alignItems: "center", position: "relative", zIndex: 20 }}>
            <input type="date" value={rwDate} onChange={(e) => setRwDate(e.target.value)} style={field()} />
            <input value={rwLabel} onChange={(e) => setRwLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()} placeholder="Item (RENT, H PAY, VENMO…)" style={field()} />
            <ThemedSelect value={rwBank} onChange={(v) => setRwBank(v as Bank)} options={BANKS.map((b) => ({ value: b, label: BANK_LABEL[b] }))} />
            <ThemedSelect value={rwSign} onChange={(v) => setRwSign(v as "-" | "+")} options={[{ value: "-", label: "− Pay" }, { value: "+", label: "+ Income" }]} />
            <input value={rwAmount} onChange={(e) => setRwAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()} placeholder="Amount" type="number" style={field()} />
            <button onClick={addRow} style={primary()}>Add Row</button>
          </div>
        ) : (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "150px 1fr 1fr 110px", gap: 10, alignItems: "center" }}>
            <input type="date" value={azDate} onChange={(e) => setAzDate(e.target.value)} style={field()} />
            <input value={azPay} onChange={(e) => setAzPay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveAmazon()} placeholder="Pay" type="number" style={field()} />
            <input value={azGas} onChange={(e) => setAzGas(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveAmazon()} placeholder="Gas" type="number" style={field()} />
            <button onClick={saveAmazon} style={primary()}>Add Day</button>
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
      <div style={{ ...labelCap(), color: HOME_THEME.text, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        <span style={{ fontSize: 14 }}>🏦</span> Account balances
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {BANKS.map((b) => (
          <div key={b} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: HOME_THEME.muted, letterSpacing: "0.1em" }}>{BANK_LABEL[b]}</span>
            {(() => {
              const shown = beginningByBank[b] ?? 0;
              return (
                <span style={{ fontSize: 18, fontWeight: 900, color: shown < 0 ? HOME_THEME.red : HOME_THEME.text, lineHeight: 1.1 }}>{fmtMoney(shown, currency)}</span>
              );
            })()}
            <input
              value={vals[b]}
              onChange={(e) => setVals((p) => ({ ...p, [b]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="set balance…"
              type="number"
              title="Set this account's balance"
              style={{ ...field(), width: 104, padding: "6px 10px", fontSize: 12 }}
            />
          </div>
        ))}
        <button onClick={save} style={{ ...primary(), alignSelf: "flex-end" }}>{saved ? "Saved ✓" : "Save"}</button>
      </div>
    </div>
  );
}

type ComputedRow = { id: number; entry_date: string; label: string; bank: Bank; amount: number; is_beginning: number; recurring: boolean; balance: number; balances: Record<Bank, number>; total: number };

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
          <div style={{ fontSize: 14, fontWeight: 900 }}>Recurring entries</div>
          <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 3 }}>Anything that repeats — they appear on every month&apos;s Payments automatically.</div>
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
                <span style={{ fontSize: 12, color: HOME_THEME.muted }}>{FREQ_LABEL[rule.frequency]}</span>
                <span style={{ fontSize: 12, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{BANK_LABEL[rule.bank]}</span>
                <span style={{ fontWeight: 800, color: inc ? HOME_THEME.green : HOME_THEME.red }}>{inc ? "+" : ""}{fmtMoney(rule.amount, currency)}</span>
                <button
                  onClick={() => onUpdate(rule.id, { active: rule.active ? 0 : 1 })}
                  title={rule.active ? "Pause (hide from Payments)" : "Resume"}
                  style={{ ...ghost(), padding: "6px 10px", fontSize: 11 }}
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

// SVG line chart of the running combined balance across the month.
function ProjectionChart({ series, currency }: { series: { date: string; balance: number }[]; currency: string }) {
  if (series.length < 2) {
    return <div style={{ height: 150, display: "grid", placeItems: "center", color: HOME_THEME.muted, fontSize: 12 }}>Add entries to see the projection.</div>;
  }
  const W = 560, H = 150, padL = 4, padR = 4, padT = 8, padB = 18;
  const ys = series.map((p) => p.balance);
  const maxY = Math.max(...ys, 0);
  const minY = Math.min(...ys, 0);
  const span = Math.max(maxY - minY, 1);
  const x = (i: number) => padL + (i / (series.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - minY) / span) * (H - padT - padB);
  const zeroY = y(0);
  const path = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(" ");
  // Light date ticks (about 8 across).
  const ticks = series.filter((_, i) => i % Math.ceil(series.length / 8) === 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 5" />
      <path d={path} fill="none" stroke={HOME_THEME.orange} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {ticks.map((p, i) => (
        <text key={i} x={x(series.indexOf(p))} y={H - 4} fill={HOME_THEME.muted} fontSize={9} textAnchor="middle">{shortDate(p.date)}</text>
      ))}
    </svg>
  );
}

// Horizontal red bars, biggest expense first.
function TopExpenses({ items, currency }: { items: { label: string; amount: number }[]; currency: string }) {
  if (!items.length) return <div style={{ height: 150, display: "grid", placeItems: "center", color: HOME_THEME.muted, fontSize: 12 }}>No expenses yet.</div>;
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: HOME_THEME.muted, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>{it.label}</span>
          <div style={{ position: "relative", height: 16, background: "rgba(255,255,255,0.04)", borderRadius: 5 }}>
            <div style={{ width: `${Math.max(6, (it.amount / max) * 100)}%`, height: "100%", borderRadius: 5, background: "linear-gradient(90deg, rgba(239,68,68,0.55), rgba(239,68,68,0.95))" }} />
            <span style={{ position: "absolute", right: 6, top: 0, lineHeight: "16px", fontSize: 10, fontWeight: 700, color: HOME_THEME.text }}>{fmtMoney(it.amount, currency)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Day-grouped register: collapsible header (date, count, daily net, EOD) over
// rows of LABEL | COASTAL | TRUIST | SECU | BALANCE (single running balance).
function GroupedRegister({
  groups,
  beginningBalance,
  currency,
  onEdit,
  onDelete,
}: {
  groups: DayGroup[];
  beginningBalance: number | null;
  currency: string;
  onEdit: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (!groups.length && beginningBalance === null) {
    return <div style={{ padding: "26px 16px", textAlign: "center", color: HOME_THEME.muted }}>Set your starting balances, then add rows below.</div>;
  }
  const longDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ position: "sticky", top: 0, background: HOME_THEME.panelBgStrong, backdropFilter: "blur(8px)", zIndex: 2 }}>
          <th style={{ ...th("left"), width: 220 }}>Date</th>
          <th style={th("left")}>Label</th>
          <th style={th("right")}>Amount</th>
          <th style={th("right")}>Balance</th>
          <th style={th("center")}></th>
        </tr>
      </thead>
      <tbody>
        {beginningBalance !== null && (
          <tr style={{ background: "linear-gradient(90deg, rgba(33,158,188,0.07), transparent)", borderBottom: `1px solid ${HOME_THEME.border}` }}>
            <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: HOME_THEME.cyan }}>STARTING BALANCE</span>
            </td>
            <td colSpan={2} style={{ padding: "11px 16px", color: HOME_THEME.muted, fontSize: 12 }}>Beginning of month</td>
            <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 900, fontSize: 15, color: beginningBalance < 0 ? HOME_THEME.red : HOME_THEME.text }}>{fmtMoney(beginningBalance, currency)}</td>
            <td />
          </tr>
        )}
        {groups.map((g) => {
          const isCollapsed = collapsed[g.date];
          const netColor = g.dailyNet > 0 ? HOME_THEME.green : g.dailyNet < 0 ? HOME_THEME.red : HOME_THEME.muted;
          return (
            <GroupBlock
              key={g.date}
              group={g}
              isCollapsed={!!isCollapsed}
              onToggle={() => setCollapsed((p) => ({ ...p, [g.date]: !p[g.date] }))}
              currency={currency}
              longDate={longDate}
              netColor={netColor}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function GroupBlock({
  group: g, isCollapsed, onToggle, currency, longDate, netColor, onEdit, onDelete,
}: {
  group: DayGroup; isCollapsed: boolean; onToggle: () => void; currency: string;
  longDate: (iso: string) => string; netColor: string;
  onEdit: (id: number, patch: Record<string, unknown>) => void; onDelete: (id: number) => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: "rgba(255,255,255,0.05)", borderTop: `1px solid ${HOME_THEME.border}` }}>
        <td style={{ padding: "9px 16px", whiteSpace: "nowrap", fontWeight: 800 }}>
          <span style={{ display: "inline-block", width: 14, color: HOME_THEME.muted }}>{isCollapsed ? "▸" : "▾"}</span>
          {longDate(g.date)}
        </td>
        <td colSpan={2} style={{ padding: "9px 8px" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: HOME_THEME.muted, background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "2px 8px" }}>{g.rows.length} {g.rows.length === 1 ? "item" : "items"}</span>
        </td>
        <td colSpan={2} style={{ padding: "9px 16px", textAlign: "right" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: netColor, marginRight: 16 }}>
            {g.dailyNet === 0 ? "Daily Net: 0.00" : `Daily Net: ${g.dailyNet > 0 ? "+" : ""}${fmtMoney(g.dailyNet, currency)}`}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: g.eod < 0 ? HOME_THEME.red : HOME_THEME.text }}>
            EOD Balance: {fmtMoney(g.eod, currency)}
          </span>
        </td>
      </tr>
      {!isCollapsed && g.rows.map((r) => {
        const isIncome = r.amount > 0;
        return (
          <tr key={r.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
            <td style={{ padding: "7px 16px", whiteSpace: "nowrap", color: HOME_THEME.muted, fontWeight: 700 }}>{shortDate(r.entry_date)}</td>
            <td style={{ padding: "7px 8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {r.recurring
                  ? <span style={{ fontWeight: 700, fontStyle: "italic" }}>{r.label}</span>
                  : <EditableText value={r.label} onCommit={(v) => onEdit(r.id, { label: v.toUpperCase() })} style={{ fontWeight: 700 }} />}
                {r.recurring && <span title="Recurring — manage in the Recurring panel" style={{ fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 5, border: `1px solid ${HOME_THEME.cyan}`, color: HOME_THEME.cyan }}>AUTO</span>}
              </div>
            </td>
            <td style={{ padding: "7px 16px", textAlign: "right" }}>
              <span style={{ fontWeight: 800, color: isIncome ? HOME_THEME.green : r.amount < 0 ? HOME_THEME.red : HOME_THEME.text }}>
                {r.recurring ? fmtMoney(r.amount, currency) : <EditableMoney value={r.amount} onCommit={(v) => onEdit(r.id, { amount: v })} />}
              </span>
            </td>
            <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 800, color: r.balance < 0 ? HOME_THEME.red : HOME_THEME.text }}>{fmtMoney(r.balance, currency)}</td>
            <td style={{ padding: "7px 10px", textAlign: "center" }}>{!r.recurring && <DeleteButton onClick={() => onDelete(r.id)} />}</td>
          </tr>
        );
      })}
    </>
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
        border: `1px solid ${hover ? HOME_THEME.red : "rgba(239,68,68,0.35)"}`,
        background: hover ? "rgba(239,68,68,0.22)" : "rgba(239,68,68,0.08)",
        color: HOME_THEME.red,
        cursor: "pointer",
        fontSize: 16,
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

function AmazonTable({ rows, currency, onDelete }: { rows: (AmazonRow & { net: number })[]; currency: string; onDelete: (id: number) => void }) {
  const totalPay = rows.reduce((s, r) => s + r.pay, 0);
  const totalGas = rows.reduce((s, r) => s + r.gas, 0);
  const totalNet = totalPay - totalGas;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ position: "sticky", top: 0, background: HOME_THEME.panelBgStrong, backdropFilter: "blur(8px)", zIndex: 1 }}>
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
              <span style={{ color: HOME_THEME.muted, marginLeft: 8, fontSize: 11 }}>{weekday(r.work_date)}</span>
            </td>
            <td style={{ padding: "10px 16px", textAlign: "right" }}>{fmtMoney(r.pay, currency)}</td>
            <td style={{ padding: "10px 16px", textAlign: "right", color: HOME_THEME.orange }}>{fmtMoney(r.gas, currency)}</td>
            <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 900, color: r.net >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{fmtMoney(r.net, currency)}</td>
            <td style={{ padding: "10px 12px", textAlign: "center" }}>
              <DeleteButton onClick={() => onDelete(r.id)} />
            </td>
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr style={{ position: "sticky", bottom: 0, background: HOME_THEME.panelBgStrong, backdropFilter: "blur(8px)" }}>
            <td style={{ padding: "12px 16px", fontWeight: 900, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.12em", color: HOME_THEME.muted }}>Total</td>
            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900 }}>{fmtMoney(totalPay, currency)}</td>
            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900, color: HOME_THEME.orange }}>{fmtMoney(totalGas, currency)}</td>
            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900, color: totalNet >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{fmtMoney(totalNet, currency)}</td>
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
        style={{ ...field(), padding: "4px 8px", fontSize: 13 }}
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
        style={{ ...field(), padding: "4px 8px", fontSize: 13, width: 100, textAlign: "right" }}
      />
    );
  }
  return <span onClick={() => setEditing(true)} style={{ cursor: "text" }}>{fmtMoney(value)}</span>;
}

function th(align: "left" | "right" | "center"): React.CSSProperties {
  return { textAlign: align, padding: "12px 16px", color: HOME_THEME.muted, fontWeight: 800, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", borderBottom: `1px solid ${HOME_THEME.border}` };
}
function card(): React.CSSProperties {
  return { background: HOME_THEME.panelBg, backdropFilter: "blur(16px)", borderRadius: 18, border: `1px solid ${HOME_THEME.border}`, boxShadow: "0 18px 40px rgba(0,0,0,0.22)" };
}
// hex → rgba for accent tints.
function bRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
// Warm-weighted accent rotation (no cyan) so the cards alternate color instead
// of reading all-blue. Each adds a colored top strip + radial glow over card().
const CARD_ACCENTS = [HOME_THEME.orange, HOME_THEME.purple, HOME_THEME.green, HOME_THEME.red];
function cardAccent(i: number): React.CSSProperties {
  const c = CARD_ACCENTS[((i % CARD_ACCENTS.length) + CARD_ACCENTS.length) % CARD_ACCENTS.length];
  return {
    ...card(),
    borderTop: `2px solid ${bRgba(c, 0.85)}`,
    background: `radial-gradient(circle at 50% 0%, ${bRgba(c, 0.16)} 0%, transparent 62%), ${HOME_THEME.panelBg}`,
  };
}
function field(): React.CSSProperties {
  return { padding: "10px 12px", borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.30)", color: HOME_THEME.text, outline: "none", width: "100%", fontSize: 13, colorScheme: "dark", accentColor: HOME_THEME.cyan, appearance: "none", WebkitAppearance: "none", MozAppearance: "textfield" as const };
}
function labelCap(): React.CSSProperties {
  return { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, marginBottom: 6 };
}
function primary(): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(33,158,188,0.25)", background: "linear-gradient(180deg, rgba(33,158,188,0.16), rgba(33,158,188,0.05))", color: HOME_THEME.cyan, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap" };
}
function ghost(): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.04)", color: HOME_THEME.text, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" };
}
function pill(active: boolean): React.CSSProperties {
  return { padding: "8px 16px", borderRadius: 999, border: active ? "1px solid rgba(33,158,188,0.35)" : `1px solid ${HOME_THEME.border}`, background: active ? "rgba(33,158,188,0.12)" : "rgba(255,255,255,0.04)", color: active ? HOME_THEME.cyan : HOME_THEME.text, fontSize: 13, fontWeight: 800, cursor: "pointer" };
}
