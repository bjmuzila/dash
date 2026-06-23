"use client";

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";

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

    const rows: ({ id: number; entry_date: string; label: string; bank: Bank; amount: number; is_beginning: number; recurring: boolean; balances: Record<Bank, number>; total: number })[] = [];
    if (anyBeginning) {
      rows.push({
        id: -1, entry_date: register.find((r) => r.is_beginning)?.entry_date ?? `${month}-01`,
        label: "BEGINNING", bank: "secu", amount: 0, is_beginning: 1, recurring: false,
        balances: { ...bal }, total: bal.coastal + bal.truist + bal.secu,
      });
    }

    let income = 0;
    let payments = 0;
    for (const ln of lines) {
      bal[ln.bank] += ln.amount; // signed: payment negative, income positive
      if (ln.amount > 0) income += ln.amount;
      else payments += ln.amount;
      rows.push({ id: ln.id, entry_date: ln.entry_date, label: ln.label, bank: ln.bank, amount: ln.amount, is_beginning: 0, recurring: ln.recurring, balances: { ...bal }, total: bal.coastal + bal.truist + bal.secu });
    }

    return { rows, income, payments, beginningByBank, anyBeginning, totals: { ...bal }, grandTotal: bal.coastal + bal.truist + bal.secu };
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
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow, color: HOME_THEME.text, fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px, 2vw, 24px)", gap: 14 }}>
        {/* Title banner — mirrors the PAYMENTS / month layout from the sheet */}
        <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
          <div style={{ textAlign: "center", padding: "12px 18px 6px" }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.16em" }}>PAYMENTS</div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.2em", color: HOME_THEME.muted, marginTop: 2 }}>{monthLabel.toUpperCase()}</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "10px 18px 16px", borderTop: `1px solid ${HOME_THEME.border}` }}>
            <div>
              <div style={labelCap()}>Month</div>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...field(), width: 170 }} />
            </div>
            <BeginningEditor beginningByBank={computed.beginningByBank} onSave={saveBeginning} currency={currency} />
          </div>
        </div>

        {/* Current balance per bank + combined total */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
          {[
            { label: "Coastal", value: computed.totals.coastal, color: computed.totals.coastal < 0 ? HOME_THEME.red : HOME_THEME.text },
            { label: "Truist", value: computed.totals.truist, color: computed.totals.truist < 0 ? HOME_THEME.red : HOME_THEME.text },
            { label: "SECU", value: computed.totals.secu, color: computed.totals.secu < 0 ? HOME_THEME.red : HOME_THEME.text },
            { label: "Total (all banks)", value: computed.grandTotal, color: computed.grandTotal < 0 ? HOME_THEME.red : HOME_THEME.cyan },
          ].map((t) => (
            <div key={t.label} style={{ ...card(), padding: 16 }}>
              <div style={labelCap()}>{t.label}</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900, color: t.color }}>{fmtMoney(t.value, currency)}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {([["register", "Payments"], ["amazon", "Amazon"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={pill(tab === k)}>{l}</button>
          ))}
          {tab === "register" && (
            <button onClick={() => setShowHpay((v) => !v)} style={{ ...pill(false), marginLeft: 4 }}>+ Auto H PAY (bi-weekly)</button>
          )}
          {loading && <span style={{ fontSize: 12, color: HOME_THEME.muted, marginLeft: 6 }}>Loading…</span>}
        </div>

        {showHpay && tab === "register" && (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto auto", gap: 10, alignItems: "end" }}>
            <div><div style={labelCap()}>First pay date</div><input type="date" value={hpayAnchor} onChange={(e) => setHpayAnchor(e.target.value)} style={field()} /></div>
            <div><div style={labelCap()}>Amount</div><input type="number" value={hpayAmount} onChange={(e) => setHpayAmount(e.target.value)} style={field()} /></div>
            <div><div style={labelCap()}>Bank</div><select value={hpayBank} onChange={(e) => setHpayBank(e.target.value as Bank)} style={field()}>{BANKS.map((b) => <option key={b} value={b}>{BANK_LABEL[b]}</option>)}</select></div>
            <button onClick={generateHpay} style={primary()}>Generate</button>
            <button onClick={() => setShowHpay(false)} style={ghost()}>Cancel</button>
            <div style={{ gridColumn: "1 / -1", fontSize: 11, color: HOME_THEME.muted }}>Inserts H PAY every 14 days through {monthLabel}. Re-running replaces the prior set.</div>
          </div>
        )}

        {/* Content */}
        <div style={{ ...card(), flex: 1, minHeight: 0, overflow: "auto", padding: 0 }}>
          {tab === "register" ? (
            <RegisterTable rows={computed.rows} currency={currency} onEdit={editRow} onDelete={deleteRow} />
          ) : (
            <AmazonTable rows={amazonComputed.rows} currency={currency} onDelete={deleteAz} />
          )}
        </div>

        {/* Composer */}
        {tab === "register" ? (
          <div style={{ ...card(), padding: 14, display: "grid", gridTemplateColumns: "140px 1fr 130px 90px 130px 110px", gap: 10, alignItems: "center" }}>
            <input type="date" value={rwDate} onChange={(e) => setRwDate(e.target.value)} style={field()} />
            <input value={rwLabel} onChange={(e) => setRwLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()} placeholder="Item (RENT, H PAY, VENMO…)" style={field()} />
            <select value={rwBank} onChange={(e) => setRwBank(e.target.value as Bank)} style={field()}>{BANKS.map((b) => <option key={b} value={b}>{BANK_LABEL[b]}</option>)}</select>
            <select value={rwSign} onChange={(e) => setRwSign(e.target.value as "-" | "+")} style={field()}>
              <option value="-">− Pay</option>
              <option value="+">+ Income</option>
            </select>
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

function BeginningEditor({ beginningByBank, onSave, currency }: { beginningByBank: Record<Bank, number | null>; onSave: (balances: Record<Bank, number>) => void; currency: string }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<Bank, string>>({ coastal: "", truist: "", secu: "" });

  const startEdit = () => {
    setVals({
      coastal: beginningByBank.coastal !== null ? String(beginningByBank.coastal) : "",
      truist: beginningByBank.truist !== null ? String(beginningByBank.truist) : "",
      secu: beginningByBank.secu !== null ? String(beginningByBank.secu) : "",
    });
    setOpen(true);
  };
  const save = () => {
    onSave({ coastal: Number(vals.coastal || 0), truist: Number(vals.truist || 0), secu: Number(vals.secu || 0) });
    setOpen(false);
  };

  const anySet = BANKS.some((b) => beginningByBank[b] !== null);

  if (!open) {
    return (
      <div>
        <div style={labelCap()}>Current balances</div>
        <button onClick={startEdit} style={ghost()}>
          {anySet
            ? BANKS.map((b) => `${BANK_LABEL[b]} ${fmtMoney(beginningByBank[b] ?? 0, currency)}`).join("   ")
            : "Set starting balances"}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div style={labelCap()}>Current balances (each account)</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {BANKS.map((b) => (
          <div key={b} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: HOME_THEME.muted, letterSpacing: "0.1em" }}>{BANK_LABEL[b]}</span>
            <input value={vals[b]} onChange={(e) => setVals((p) => ({ ...p, [b]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="0.00" type="number" style={{ ...field(), width: 110 }} />
          </div>
        ))}
        <button onClick={save} style={{ ...primary(), alignSelf: "flex-end" }}>Save</button>
      </div>
    </div>
  );
}

function RegisterTable({
  rows,
  currency,
  onEdit,
  onDelete,
}: {
  rows: (RegisterRow & { balances: Record<Bank, number>; total: number })[];
  currency: string;
  onEdit: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
}) {
  const cols: Bank[] = ["coastal", "truist", "secu"];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ position: "sticky", top: 0, background: HOME_THEME.panelBgStrong, backdropFilter: "blur(8px)", zIndex: 1 }}>
          <th style={th("left")}>Date</th>
          <th style={th("left")}>Item</th>
          {cols.map((c) => <th key={c} style={th("right")}>{BANK_LABEL[c]}</th>)}
          <th style={th("right")}>Total</th>
          <th style={th("center")}></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={7} style={{ padding: "22px 16px", textAlign: "center", color: HOME_THEME.muted }}>Set starting balances, then add rows below.</td></tr>
        )}
        {rows.map((r) => {
          const isIncome = !r.is_beginning && r.amount > 0;
          return (
            <tr key={r.id} style={{ borderBottom: `1px solid ${HOME_THEME.border}`, background: r.is_beginning ? "rgba(255,255,255,0.05)" : "transparent" }}>
              <td style={{ padding: "8px 16px", whiteSpace: "nowrap", color: HOME_THEME.muted, fontWeight: 700 }}>
                {r.is_beginning ? "" : shortDate(r.entry_date)}
              </td>
              <td style={{ padding: "8px 16px" }}>
                {r.is_beginning ? (
                  <span style={{ fontWeight: 900, letterSpacing: "0.06em" }}>BEGINNING</span>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <EditableText value={r.label} onCommit={(v) => onEdit(r.id, { label: v.toUpperCase() })} style={{ fontWeight: 800 }} />
                    <span
                      title="Amount applied to this row"
                      style={{ fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 6, background: isIncome ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.14)", color: isIncome ? HOME_THEME.green : HOME_THEME.red }}
                    >
                      <EditableMoney value={r.amount} onCommit={(v) => onEdit(r.id, { amount: v })} />
                    </span>
                    <span style={{ fontSize: 10, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{BANK_LABEL[r.bank]}</span>
                  </div>
                )}
              </td>
              {cols.map((c) => {
                const here = r.bank === c;
                const v = r.balances[c];
                return (
                  <td key={c} style={{ padding: "8px 16px", textAlign: "right", fontWeight: here ? 900 : 600, color: v < 0 ? HOME_THEME.red : here ? HOME_THEME.text : "rgba(255,255,255,0.55)", background: here && !r.is_beginning ? (isIncome ? "rgba(16,185,129,0.10)" : "rgba(255,255,255,0.03)") : "transparent" }}>
                    {fmtMoney(v, currency)}
                  </td>
                );
              })}
              <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 900, color: r.total < 0 ? HOME_THEME.red : HOME_THEME.cyan }}>
                {fmtMoney(r.total, currency)}
              </td>
              <td style={{ padding: "8px 12px", textAlign: "center" }}>
                {!r.is_beginning && <DeleteButton onClick={() => onDelete(r.id)} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
function field(): React.CSSProperties {
  return { padding: "10px 12px", borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.30)", color: HOME_THEME.text, outline: "none", width: "100%", fontSize: 13 };
}
function labelCap(): React.CSSProperties {
  return { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, marginBottom: 6 };
}
function primary(): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,240,255,0.25)", background: "linear-gradient(180deg, rgba(0,240,255,0.16), rgba(0,240,255,0.05))", color: HOME_THEME.cyan, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap" };
}
function ghost(): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.04)", color: HOME_THEME.text, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" };
}
function pill(active: boolean): React.CSSProperties {
  return { padding: "8px 16px", borderRadius: 999, border: active ? "1px solid rgba(0,240,255,0.35)" : `1px solid ${HOME_THEME.border}`, background: active ? "rgba(0,240,255,0.12)" : "rgba(255,255,255,0.04)", color: active ? HOME_THEME.cyan : HOME_THEME.text, fontSize: 13, fontWeight: 800, cursor: "pointer" };
}
