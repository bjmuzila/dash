"use client";

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";

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

const PERIODS = ["daily", "weekly", "monthly", "yearly"];

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
}

function getAccent(index: number) {
  const colors = ["#66a6ff", "#f97316", "#f43f5e", "#22c55e", "#facc15", "#a78bfa"];
  return colors[index % colors.length];
}

export default function BudgetPage() {
  const [profile, setProfile] = useState<BudgetProfile | null>(null);
  const [profiles, setProfiles] = useState<BudgetProfile[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"all" | "expense" | "income">("all");
  const [showComposer, setShowComposer] = useState(false);
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

  useEffect(() => {
    void refresh();
  }, []);

  const activeCurrency = profile?.currency || "USD";

  const visibleEntries = useMemo(
    () => entries.filter((entry) => filterType === "all" ? true : entry.type === filterType),
    [entries, filterType]
  );

  const totals = useMemo(() => {
    const income = entries.filter((e) => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
    const expense = entries.filter((e) => e.type === "expense").reduce((sum, e) => sum + e.amount, 0);
    const budget = categories.reduce((sum, c) => sum + c.amount, 0);
    const remaining = income - expense - budget;
    const spentPct = budget > 0 ? Math.min(100, (expense / budget) * 100) : 0;
    return { income, expense, budget, remaining, spentPct };
  }, [entries, categories]);

  const categoryRows = useMemo(() => {
    return categories.map((cat, index) => {
      const spent = entries
        .filter((entry) => entry.type === "expense" && entry.category_id === cat.id)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const percent = cat.amount > 0 ? Math.min(100, (spent / cat.amount) * 100) : 0;
      return {
        ...cat,
        spent,
        left: cat.amount - spent,
        percent,
        accent: cat.color || getAccent(index),
      };
    }).sort((a, b) => b.spent - a.spent);
  }, [categories, entries]);

  const chartPoints = useMemo(() => {
    const ordered = [...entries].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
    let running = 0;
    return ordered.map((entry, index) => {
      running += entry.type === "income" ? entry.amount : -entry.amount;
      return { x: index, y: running };
    });
  }, [entries]);

  const chartPath = useMemo(() => {
    if (!chartPoints.length) return "";
    const maxY = Math.max(...chartPoints.map((p) => p.y), 1);
    const minY = Math.min(...chartPoints.map((p) => p.y), 0);
    const width = 320;
    const height = 160;
    const span = Math.max(maxY - minY, 1);
    return chartPoints.map((point, index) => {
      const x = chartPoints.length === 1 ? 0 : (index / (chartPoints.length - 1)) * width;
      const y = height - ((point.y - minY) / span) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }, [chartPoints]);

  const saveCategory = async () => {
    await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "category",
        profileName,
        name: categoryName.trim(),
        amount: Number(categoryAmount),
        period: categoryPeriod,
      }),
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
        title: entryTitle.trim(),
        amount: Number(entryAmount),
        type: entryType,
        categoryId: entryCategoryId || null,
        notes: entryNotes.trim(),
        occurredAt: new Date().toISOString(),
      }),
    });
    setEntryTitle("");
    setEntryAmount("");
    setEntryNotes("");
    setShowComposer(false);
    await refresh();
  };

  const monthStart = new Date();
  monthStart.setDate(1);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const today = new Date().getDate();
  const dayPct = Math.min(100, (today / daysInMonth) * 100);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow, color: HOME_THEME.text, fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px, 2vw, 24px)", gap: 18 }}>
        <div style={{ ...homeCard(), padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", color: HOME_THEME.cyan }}>Budget</div>
            <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6, lineHeight: 1.05 }}>Monthly Spending</div>
            <div style={{ fontSize: 13, color: HOME_THEME.muted, marginTop: 6 }}>Persistent PostgreSQL storage, no proxy, same visual language as home.</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <select value={profileName} onChange={(e) => setProfileName(e.target.value)} style={fieldStyle()}>
              {profiles.length ? profiles.map((item) => <option key={item.id} value={item.name}>{item.name}</option>) : <option value="Default">Default</option>}
            </select>
            <button onClick={refresh} style={ghostButton()}>Refresh</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
          {[
            { label: "Income", value: fmtMoney(totals.income, activeCurrency), color: HOME_THEME.green },
            { label: "Expenses", value: fmtMoney(totals.expense, activeCurrency), color: HOME_THEME.red },
            { label: "Budgets", value: fmtMoney(totals.budget, activeCurrency), color: HOME_THEME.orange },
            { label: "Remaining", value: fmtMoney(totals.remaining, activeCurrency), color: totals.remaining >= 0 ? HOME_THEME.cyan : HOME_THEME.red },
          ].map((tile) => (
            <div key={tile.label} style={{ ...homeCard(), padding: 18, minHeight: 110 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.16em", color: HOME_THEME.muted }}>{tile.label}</div>
              <div style={{ marginTop: 10, fontSize: 28, fontWeight: 900, color: tile.color }}>{tile.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, minHeight: 0, flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
            <div style={{ ...homeCard(), padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Monthly Spending</div>
                  <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{fmtMoney(totals.budget - totals.expense, activeCurrency)} left of {fmtMoney(totals.budget || totals.income, activeCurrency)}</div>
                </div>
                <div style={{ width: 34, height: 34, borderRadius: 999, background: "rgba(255,255,255,0.06)", display: "grid", placeItems: "center", color: HOME_THEME.cyan }}>↻</div>
              </div>
              <div style={{ position: "relative", marginTop: 6, marginBottom: 10 }}>
                <div style={{ height: 18, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
                  <div style={{ width: `${totals.spentPct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, rgba(102,166,255,0.65), rgba(0,240,255,0.75))` }} />
                </div>
                <div style={{ position: "absolute", left: `${dayPct}%`, top: -6, width: 3, height: 30, background: "rgba(255,255,255,0.6)", transform: "translateX(-50%)" }} />
                <div style={{ position: "absolute", left: `${Math.max(0, dayPct - 4)}%`, top: -24, padding: "4px 8px", borderRadius: 8, background: "#000", fontSize: 11, color: "#fff", transform: "translateX(-50%)" }}>Today</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: HOME_THEME.muted }}>
                <span>{monthStart.toLocaleString("en-US", { month: "short" })}. 1</span>
                <span>{monthStart.toLocaleString("en-US", { month: "short" })}. {daysInMonth}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 13, color: HOME_THEME.muted }}>
                You can keep spending {fmtMoney(Math.max(totals.budget - totals.expense, 0) / Math.max(daysInMonth - today + 1, 1), activeCurrency)} for {Math.max(daysInMonth - today, 0)} more days
              </div>
            </div>

            <div style={{ ...homeCard(), padding: 18, minHeight: 260 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Balance Trend</div>
                  <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>Running balance from saved entries.</div>
                </div>
              </div>
              <div style={{ height: 200, borderRadius: 18, background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}`, padding: 14 }}>
                <svg viewBox="0 0 320 160" width="100%" height="100%" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="budgetFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(102,166,255,0.45)" />
                      <stop offset="100%" stopColor="rgba(102,166,255,0.02)" />
                    </linearGradient>
                  </defs>
                  {[0, 40, 80, 120, 160].map((y) => (
                    <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 6" />
                  ))}
                  {chartPath && (
                    <>
                      <path d={`${chartPath} L 320 160 L 0 160 Z`} fill="url(#budgetFill)" />
                      <path d={chartPath} fill="none" stroke={HOME_THEME.cyan} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}
                </svg>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
            <div style={{ ...homeCard(), padding: 18, minHeight: 0, flex: 1, overflow: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Categories</div>
                  <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>Budgets by category with saved amounts.</div>
                </div>
                {loading && <div style={{ fontSize: 12, color: HOME_THEME.muted }}>Loading...</div>}
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {categoryRows.map((cat) => (
                  <div key={cat.id} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 16, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 42, height: 42, borderRadius: 999, border: `3px solid ${cat.accent}`, display: "grid", placeItems: "center", color: cat.accent, fontSize: 18, background: "rgba(255,255,255,0.03)" }}>•</div>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800 }}>{cat.name}</div>
                          <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 4 }}>{cat.period} • {cat.spent} entries tracked</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 18, fontWeight: 900 }}>{fmtMoney(cat.spent, activeCurrency)} / {fmtMoney(cat.amount, activeCurrency)}</div>
                        <div style={{ fontSize: 11, color: cat.left >= 0 ? HOME_THEME.green : HOME_THEME.red, marginTop: 4 }}>{fmtMoney(cat.left, activeCurrency)} left</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{ width: `${cat.percent}%`, height: "100%", borderRadius: 999, background: cat.accent }} />
                    </div>
                  </div>
                ))}
                {!categoryRows.length && <div style={{ color: HOME_THEME.muted, fontSize: 12 }}>Add a category to start.</div>}
              </div>

              <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.8fr 0.8fr", gap: 10 }}>
                <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Category" style={fieldStyle()} />
                <input value={categoryAmount} onChange={(e) => setCategoryAmount(e.target.value)} placeholder="Amount" type="number" style={fieldStyle()} />
                <select value={categoryPeriod} onChange={(e) => setCategoryPeriod(e.target.value)} style={fieldStyle()}>
                  {PERIODS.map((period) => <option key={period} value={period}>{period}</option>)}
                </select>
                <button onClick={saveCategory} style={primaryButton()}>Save</button>
              </div>
            </div>

            <div style={{ ...homeCard(), padding: 18, minHeight: 0, flex: 1, overflow: "auto", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Transactions</div>
                  <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>Saved permanently in PostgreSQL.</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["all", "expense", "income"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      style={{
                        ...pillButton(filterType === type),
                        textTransform: "capitalize",
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {visibleEntries.map((entry) => (
                  <div key={entry.id} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 14, padding: 12, display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.title}</div>
                      <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {new Date(entry.occurred_at).toLocaleString()} {entry.notes ? `• ${entry.notes}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: entry.type === "income" ? HOME_THEME.green : HOME_THEME.red }}>
                        {entry.type === "income" ? "+" : "-"}{fmtMoney(entry.amount, activeCurrency)}
                      </div>
                      <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 4 }}>{entry.type}</div>
                    </div>
                  </div>
                ))}
                {!visibleEntries.length && <div style={{ color: HOME_THEME.muted, fontSize: 12 }}>No entries in this filter.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowComposer((v) => !v)}
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          width: 64,
          height: 64,
          borderRadius: 20,
          border: "none",
          background: "linear-gradient(180deg, #5860ff, #7f6cff)",
          color: "#fff",
          fontSize: 34,
          fontWeight: 400,
          boxShadow: "0 18px 40px rgba(88,96,255,0.35)",
          cursor: "pointer",
        }}
      >
        +
      </button>

      {showComposer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3,5,10,0.72)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 20 }}>
          <div style={{ width: "min(560px, 100%)", ...homeCard(), padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900 }}>Add Transaction</div>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, marginTop: 4 }}>This saves directly to PostgreSQL.</div>
              </div>
              <button onClick={() => setShowComposer(false)} style={ghostButton()}>Close</button>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <input value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="Title" style={fieldStyle()} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
                <input value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="Amount" type="number" style={fieldStyle()} />
                <select value={entryType} onChange={(e) => setEntryType(e.target.value as "expense" | "income")} style={fieldStyle()}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <select value={entryCategoryId} onChange={(e) => setEntryCategoryId(e.target.value)} style={fieldStyle()}>
                <option value="">No category</option>
                {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
              <textarea value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} placeholder="Notes" rows={4} style={{ ...fieldStyle(), resize: "vertical" }} />
              <button onClick={saveEntry} style={primaryButton()}>Save Transaction</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function homeCard(): React.CSSProperties {
  return {
    background: HOME_THEME.panelBg,
    backdropFilter: "blur(16px)",
    borderRadius: 18,
    border: `1px solid ${HOME_THEME.border}`,
    boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
  };
}

function fieldStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${HOME_THEME.border}`,
    background: "rgba(0,0,0,0.30)",
    color: HOME_THEME.text,
    outline: "none",
    width: "100%",
    fontSize: 13,
  };
}

function primaryButton(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,240,255,0.25)",
    background: "linear-gradient(180deg, rgba(0,240,255,0.16), rgba(0,240,255,0.05))",
    color: HOME_THEME.cyan,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    cursor: "pointer",
  };
}

function ghostButton(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${HOME_THEME.border}`,
    background: "rgba(255,255,255,0.04)",
    color: HOME_THEME.text,
    fontWeight: 800,
    cursor: "pointer",
  };
}

function pillButton(active: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 999,
    border: active ? "1px solid rgba(0,240,255,0.35)" : `1px solid ${HOME_THEME.border}`,
    background: active ? "rgba(0,240,255,0.12)" : "rgba(255,255,255,0.04)",
    color: active ? HOME_THEME.cyan : HOME_THEME.text,
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  };
}
