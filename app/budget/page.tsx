"use client";

import { useEffect, useMemo, useState } from "react";
import { homeButtonStyle, homeInputStyle, homePanelStyle, homeSecondaryButtonStyle, HOME_THEME } from "@/components/shared/homeTheme";

type BudgetProfile = { id: number; name: string; currency: string };
type BudgetCategory = { id: number; profile_id: number; name: string; amount: number; period: string; color?: string | null };
type BudgetEntry = {
  id: number;
  profile_id: number;
  category_id?: number | null;
  type: "income" | "expense";
  amount: number;
  title: string;
  notes?: string | null;
  occurred_at: string;
};

const periodToDays: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
}

export default function BudgetPage() {
  const [profile, setProfile] = useState<BudgetProfile | null>(null);
  const [profiles, setProfiles] = useState<BudgetProfile[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("Default");
  const [categoryName, setCategoryName] = useState("");
  const [categoryAmount, setCategoryAmount] = useState("0");
  const [categoryPeriod, setCategoryPeriod] = useState("monthly");
  const [entryTitle, setEntryTitle] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryType, setEntryType] = useState<"expense" | "income">("expense");
  const [entryCategoryId, setEntryCategoryId] = useState<string>("");
  const [entryNotes, setEntryNotes] = useState("");

  const refresh = async () => {
    setLoading(true);
    const res = await fetch("/api/budget", { cache: "no-store" });
    const data = await res.json();
    setProfile(data.profile);
    setProfiles(data.profiles || []);
    setCategories(data.categories || []);
    setEntries(data.entries || []);
    setProfileName(data.profile?.name || "Default");
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const totals = useMemo(() => {
    const income = entries.filter((e) => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
    const expense = entries.filter((e) => e.type === "expense").reduce((sum, e) => sum + e.amount, 0);
    const budget = categories.reduce((sum, c) => sum + c.amount, 0);
    const remaining = income - expense - budget;
    return { income, expense, budget, remaining };
  }, [entries, categories]);

  const byCategory = useMemo(() => {
    return categories.map((cat) => {
      const spent = entries
        .filter((entry) => entry.type === "expense" && entry.category_id === cat.id)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const pct = cat.amount > 0 ? Math.min(100, (spent / cat.amount) * 100) : 0;
      return { ...cat, spent, pct, left: cat.amount - spent };
    });
  }, [categories, entries]);

  const saveCategory = async () => {
    await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "category", profileName, name: categoryName, amount: Number(categoryAmount), period: categoryPeriod }),
    });
    setCategoryName("");
    setCategoryAmount("0");
    await refresh();
  };

  const saveEntry = async () => {
    await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "entry",
        profileName,
        title: entryTitle,
        amount: Number(entryAmount),
        type: entryType,
        categoryId: entryCategoryId || null,
        notes: entryNotes,
        occurredAt: new Date().toISOString(),
      }),
    });
    setEntryTitle("");
    setEntryAmount("");
    setEntryNotes("");
    await refresh();
  };

  const activeProfileName = profile?.name || "Default";
  const activeCurrency = profile?.currency || "USD";

  return (
    <div style={{ flex: 1, overflow: "hidden", color: HOME_THEME.text, background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow, fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px, 2vw, 24px)", gap: 18 }}>
        <div style={{ ...homePanelStyle, padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: HOME_THEME.cyan, fontWeight: 700 }}>Budget</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{activeProfileName}</div>
            <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>Saved in PostgreSQL, no proxy, persistent forever.</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} style={homeInputStyle} placeholder="Profile name" />
            <button onClick={refresh} style={homeSecondaryButtonStyle}>Refresh</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
          {[
            { label: "Income", value: fmtMoney(totals.income, activeCurrency), color: HOME_THEME.green },
            { label: "Expenses", value: fmtMoney(totals.expense, activeCurrency), color: HOME_THEME.red },
            { label: "Budgets", value: fmtMoney(totals.budget, activeCurrency), color: HOME_THEME.orange },
            { label: "Remaining", value: fmtMoney(totals.remaining, activeCurrency), color: totals.remaining >= 0 ? HOME_THEME.cyan : HOME_THEME.red },
          ].map((item) => (
            <div key={item.label} style={{ ...homePanelStyle, padding: 18 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: HOME_THEME.muted, fontWeight: 700 }}>{item.label}</div>
              <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, minHeight: 0, flex: 1 }}>
          <div style={{ ...homePanelStyle, padding: 18, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>Categories</div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>Plan your monthly envelopes and track usage.</div>
              </div>
              {loading && <div style={{ color: HOME_THEME.muted, fontSize: 12 }}>Loading...</div>}
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {byCategory.map((cat) => (
                <div key={cat.id} style={{ background: "rgba(0,0,0,0.18)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{cat.name}</div>
                      <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 4 }}>{cat.period} budget</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>{fmtMoney(cat.spent, activeCurrency)} / {fmtMoney(cat.amount, activeCurrency)}</div>
                      <div style={{ fontSize: 11, color: cat.left >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{fmtMoney(cat.left, activeCurrency)} left</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ width: `${cat.pct}%`, height: "100%", background: cat.color || `linear-gradient(90deg, ${HOME_THEME.cyan}, ${HOME_THEME.purple})` }} />
                  </div>
                </div>
              ))}
              {!byCategory.length && <div style={{ color: HOME_THEME.muted, fontSize: 12 }}>Add a category to start.</div>}
            </div>

            <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Category" style={homeInputStyle} />
              <input value={categoryAmount} onChange={(e) => setCategoryAmount(e.target.value)} placeholder="Amount" type="number" style={homeInputStyle} />
              <select value={categoryPeriod} onChange={(e) => setCategoryPeriod(e.target.value)} style={homeInputStyle}>
                {Object.keys(periodToDays).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={saveCategory} style={homeButtonStyle}>Save Category</button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
            <div style={{ ...homePanelStyle, padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>Add Entry</div>
              <div style={{ display: "grid", gap: 10 }}>
                <input value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="Title" style={homeInputStyle} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
                  <input value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="Amount" type="number" style={homeInputStyle} />
                  <select value={entryType} onChange={(e) => setEntryType(e.target.value as "income" | "expense")} style={homeInputStyle}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
                <select value={entryCategoryId} onChange={(e) => setEntryCategoryId(e.target.value)} style={homeInputStyle}>
                  <option value="">No category</option>
                  {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
                <textarea value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} placeholder="Notes" rows={3} style={{ ...homeInputStyle, resize: "vertical" }} />
                <button onClick={saveEntry} style={homeButtonStyle}>Save Entry</button>
              </div>
            </div>

            <div style={{ ...homePanelStyle, padding: 18, minHeight: 0, flex: 1, overflow: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>Recent Activity</div>
              <div style={{ display: "grid", gap: 10 }}>
                {entries.map((entry) => (
                  <div key={entry.id} style={{ background: "rgba(0,0,0,0.18)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>{entry.title}</div>
                      <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 4 }}>{new Date(entry.occurred_at).toLocaleString()} {entry.notes ? `• ${entry.notes}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: entry.type === "income" ? HOME_THEME.green : HOME_THEME.red }}>
                        {entry.type === "income" ? "+" : "-"}{fmtMoney(entry.amount, activeCurrency)}
                      </div>
                      <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 4 }}>{entry.type}</div>
                    </div>
                  </div>
                ))}
                {!entries.length && <div style={{ color: HOME_THEME.muted, fontSize: 12 }}>No saved entries yet.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
