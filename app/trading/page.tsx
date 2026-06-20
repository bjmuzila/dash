"use client";

/**
 * Trading — Journaling Dashboard.
 * React port of pages/old/trading.html, with the journal entries wired up
 * (localStorage key: trading_journals) instead of dead placeholders.
 */

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME as HT, homeShellStyle, homePanelStyle, homeButtonStyle } from "@/components/shared/homeTheme";

interface Journal {
  id: number;
  date: string;        // YYYY-MM-DD
  netPnl: number;
  trades: number;
  winRate: number;     // 0-100
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgMAE: number;
  avgMFE: number;
  commissions: number;
  notes: string;
  kind: "manual" | "verified";
}

const LS_KEY = "trading_journals";

// Keep local color aliases for green/red (used in charts + data cells)
const T = {
  green: "#10b981", red: "#ef4444",
};

const panelStyle: React.CSSProperties = {
  ...homePanelStyle, padding: 16,
};
const btnStyle = (active = false): React.CSSProperties => ({
  ...homeButtonStyle,
  background: active ? HT.cyan : "transparent",
  color: active ? HT.bg : HT.muted,
  border: `1px solid ${HT.border}`,
});
const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.4)", border: `1px solid ${HT.border}`, padding: "7px 9px",
  borderRadius: 4, color: HT.text, fontSize: 12, outline: "none", width: "100%",
  colorScheme: "dark",
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: HT.muted, textTransform: "uppercase",
  letterSpacing: ".08em", display: "block", marginBottom: 4,
};

const fmt$ = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(v).toFixed(2);

function MiniLine({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) {
    return <div style={{ height: 120, display: "grid", placeItems: "center", color: HT.muted, fontSize: 11 }}>No data yet</div>;
  }
  const w = 320, h = 120, pad = 8;
  const min = Math.min(...values, 0), max = Math.max(...values, 0);
  const range = max - min || 1;
  const x = (i: number) => pad + ((w - 2 * pad) * i) / (values.length - 1);
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - min) / range);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120 }}>
      <line x1={pad} y1={y(0)} x2={w - pad} y2={y(0)} stroke={HT.border} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function MiniBars({ values }: { values: number[] }) {
  if (!values.length) {
    return <div style={{ height: 120, display: "grid", placeItems: "center", color: HT.muted, fontSize: 11 }}>No data yet</div>;
  }
  const w = 320, h = 120, pad = 8;
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  const bw = Math.max(2, (w - 2 * pad) / values.length - 2);
  const zero = h / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120 }}>
      <line x1={pad} y1={zero} x2={w - pad} y2={zero} stroke={HT.border} />
      {values.map((v, i) => {
        const bh = (Math.abs(v) / maxAbs) * (h / 2 - pad);
        return (
          <rect key={i}
            x={pad + i * (bw + 2)} y={v >= 0 ? zero - bh : zero}
            width={bw} height={bh}
            fill={v >= 0 ? T.green : T.red} opacity={0.85} />
        );
      })}
    </svg>
  );
}

export default function TradingPage() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<"all" | "verified" | "manual">("all");
  const [tab, setTab] = useState("journal");
  const [showModal, setShowModal] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Modal fields
  const [f, setF] = useState({
    date: "", netPnl: "", trades: "", winRate: "", avgWin: "", avgLoss: "",
    profitFactor: "", avgMAE: "", avgMFE: "", commissions: "", notes: "",
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setJournals(JSON.parse(raw));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(journals)); } catch { /* ignore */ }
    }
  }, [hydrated, journals]);

  const visible = useMemo(() => {
    let v = journals;
    if (filter !== "all") v = v.filter((j) => j.kind === filter);
    if (selectedDay) v = v.filter((j) => j.date === selectedDay);
    return [...v].sort((a, b) => a.date.localeCompare(b.date));
  }, [journals, filter, selectedDay]);

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const k = useMemo(() => {
    const wins = visible.filter((j) => j.netPnl > 0);
    const losses = visible.filter((j) => j.netPnl < 0);
    const totalPnl = visible.reduce((s, j) => s + j.netPnl, 0);
    const totalTrades = visible.reduce((s, j) => s + j.trades, 0);
    const avgWin = wins.length ? wins.reduce((s, j) => s + j.netPnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, j) => s + j.netPnl, 0) / losses.length : 0;
    // Streaks
    let bestW = 0, bestL = 0, curW = 0, curL = 0;
    for (const j of visible) {
      if (j.netPnl > 0) { curW++; curL = 0; } else if (j.netPnl < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
      bestW = Math.max(bestW, curW); bestL = Math.max(bestL, curL);
    }
    // Cumulative + drawdown
    const cum: number[] = [];
    let run = 0;
    for (const j of visible) { run += j.netPnl; cum.push(run); }
    let peak = -Infinity, maxDD = 0;
    const dd: number[] = cum.map((v) => {
      peak = Math.max(peak, v);
      const d = v - peak;
      maxDD = Math.min(maxDD, d);
      return d;
    });
    const winPct = wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : null;
    return {
      wins: wins.length, losses: losses.length, winPct, totalPnl, totalTrades,
      avgWin, avgLoss, bestW, bestL, cum, dd, maxDD,
      pnlPerTrade: totalTrades > 0 ? totalPnl / totalTrades : null,
      efficiency: visible.map((j) => (j.avgMFE !== 0 ? (j.netPnl / Math.max(1, j.trades)) / Math.abs(j.avgMFE) : 0)),
    };
  }, [visible]);

  // ── Calendar ─────────────────────────────────────────────────────────────────
  const calCells = useMemo(() => {
    const first = new Date(calMonth.y, calMonth.m, 1);
    const days = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    const lead = first.getDay();
    const cells: ({ day: number; date: string; pnl: number | null } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) {
      const date = `${calMonth.y}-${String(calMonth.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayJ = journals.filter((j) => j.date === date);
      cells.push({ day: d, date, pnl: dayJ.length ? dayJ.reduce((s, j) => s + j.netPnl, 0) : null });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [calMonth, journals]);

  const monthLabel = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ── Actions ──────────────────────────────────────────────────────────────────
  const saveJournal = () => {
    if (!f.date) { setModalErr("Trading date is required."); return; }
    const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
    if (f.netPnl.trim() === "" || !Number.isFinite(num(f.netPnl))) { setModalErr("Net P&L is required and must be a number."); return; }
    setJournals((j) => [...j, {
      id: Date.now(), date: f.date, netPnl: num(f.netPnl), trades: num(f.trades),
      winRate: num(f.winRate), avgWin: num(f.avgWin), avgLoss: num(f.avgLoss),
      profitFactor: num(f.profitFactor), avgMAE: num(f.avgMAE), avgMFE: num(f.avgMFE),
      commissions: num(f.commissions), notes: f.notes, kind: "manual",
    }]);
    setF({ date: "", netPnl: "", trades: "", winRate: "", avgWin: "", avgLoss: "", profitFactor: "", avgMAE: "", avgMFE: "", commissions: "", notes: "" });
    setModalErr("");
    setShowModal(false);
  };

  const exportCSV = () => {
    const header = "date,netPnl,trades,winRate,avgWin,avgLoss,profitFactor,avgMAE,avgMFE,commissions,notes,kind";
    const rows = journals.map((j) =>
      [j.date, j.netPnl, j.trades, j.winRate, j.avgWin, j.avgLoss, j.profitFactor, j.avgMAE, j.avgMFE, j.commissions, JSON.stringify(j.notes ?? ""), j.kind].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-journals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const kpiCard = (title: string, val: React.ReactNode, sub: React.ReactNode, extra?: React.ReactNode) => (
    <div style={{ ...panelStyle, display: "flex", flexDirection: "column", minHeight: 130 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: HT.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: HT.text }}>{val}</div>
      <div style={{ fontSize: 10, color: HT.muted, marginTop: 2 }}>{sub}</div>
      {extra && <div style={{ marginTop: "auto" }}>{extra}</div>}
    </div>
  );

  return (
    <div style={{
      display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
      overflow: "hidden", ...homeShellStyle, flex: 1, minHeight: 0,
    }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 32px", borderBottom: `1px solid ${HT.border}`, background: HT.panelBgStrong, backdropFilter: "blur(16px)", flexShrink: 0,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Journaling Dashboard</div>
        <div style={{
          fontSize: 10, fontWeight: 700, color: T.green, border: `1px solid ${T.green}55`,
          background: `${T.green}18`, padding: "4px 10px", borderRadius: 20,
        }}>
          Market Open
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Filters */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button style={btnStyle(filter === "all")} onClick={() => setFilter("all")}>All Journals</button>
            <button style={btnStyle(filter === "verified")} onClick={() => setFilter("verified")}>✓ Verified</button>
            <button style={btnStyle(filter === "manual")} onClick={() => setFilter("manual")}>✎ Manual</button>
            {selectedDay && (
              <button style={btnStyle()} onClick={() => setSelectedDay(null)}>Day: {selectedDay} ✕</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button style={btnStyle()} onClick={exportCSV}>Export CSV</button>
            <button style={btnStyle(true)} onClick={() => setShowModal(true)}>+ New Journal</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${HT.border}` }}>
          {["journal", "comparison", "analysis"].map((t) => (
            <div key={t} onClick={() => setTab(t)} style={{
              padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              textTransform: "capitalize",
              color: tab === t ? HT.cyan : HT.muted,
              borderBottom: `2px solid ${tab === t ? HT.cyan : "transparent"}`,
            }}>{t}</div>
          ))}
        </div>

        {tab !== "journal" ? (
          <div style={{ ...panelStyle, display: "grid", placeItems: "center", minHeight: 240, color: HT.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: ".1em" }}>
            {tab} — coming soon
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              {kpiCard("Day Win %",
                k.winPct != null ? `${k.winPct.toFixed(0)}%` : "—",
                `${k.wins}W - ${k.losses}L`,
                <div style={{ height: 6, background: HT.border, borderRadius: 3, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${k.winPct ?? 0}%`, background: T.green }} />
                  <div style={{ width: `${k.winPct != null ? 100 - k.winPct : 0}%`, background: T.red }} />
                </div>)}
              {kpiCard("Avg Win / Loss",
                k.avgLoss !== 0 ? Math.abs(k.avgWin / k.avgLoss).toFixed(2) : "—",
                "Avg Absolute Trade",
                <div style={{ fontSize: 10 }}>
                  <div style={{ color: T.green }}>W {k.avgWin ? fmt$(k.avgWin) : "—"}</div>
                  <div style={{ color: T.red }}>L {k.avgLoss ? fmt$(k.avgLoss) : "—"}</div>
                </div>)}
              {kpiCard("Net PnL",
                <span style={{ color: k.totalPnl >= 0 ? T.green : T.red }}>{visible.length ? fmt$(k.totalPnl) : "—"}</span>,
                "Total Net PnL")}
              {kpiCard("Max Streaks", k.bestW || "—", "Best win streak",
                <div style={{ fontSize: 10 }}>
                  <div>Consecutive wins <span style={{ color: T.green }}>{k.bestW}</span></div>
                  <div>Consecutive losses <span style={{ color: T.red }}>{k.bestL}</span></div>
                </div>)}
              {kpiCard("Per Trade",
                k.pnlPerTrade != null ? fmt$(k.pnlPerTrade) : "—",
                "Net PnL / trade",
                <div style={{ fontSize: 10 }}>Total Trades <span style={{ color: HT.text }}>{k.totalTrades}</span></div>)}
            </div>

            {/* Charts strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <div style={panelStyle}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Capture Efficiency Score</div>
                <MiniLine values={k.efficiency} color="#29b6f6" />
              </div>
              <div style={panelStyle}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
                  Cumulative PnL <span style={{ color: k.totalPnl >= 0 ? T.green : T.red }}>{visible.length ? fmt$(k.totalPnl) : "—"}</span>
                </div>
                <MiniLine values={k.cum} color={T.green} />
              </div>
              <div style={panelStyle}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
                  Drawdown (Max) <span style={{ color: T.red }}>{visible.length ? fmt$(k.maxDD) : "—"}</span>
                </div>
                <MiniLine values={k.dd} color={T.red} />
              </div>
              <div style={panelStyle}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>PnL Per Day</div>
                <MiniBars values={visible.map((j) => j.netPnl)} />
              </div>
            </div>

            {/* Tables */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <div style={panelStyle}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, targets: !c.targets }))}
                  style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", cursor: "pointer" }}
                >
                  <span>Session vs Targets</span><span>{collapsed.targets ? "▶" : "▼"}</span>
                </div>
                {!collapsed.targets && (
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <tbody>
                      {[
                        ["Avg Win", k.avgWin ? fmt$(k.avgWin) : "—"],
                        ["Avg Loss", k.avgLoss ? fmt$(k.avgLoss) : "—"],
                        ["Avg MAE", visible.length ? fmt$(visible.reduce((s, j) => s + j.avgMAE, 0) / visible.length) : "—"],
                        ["Win Ratio", k.winPct != null ? `${k.winPct.toFixed(1)}%` : "—"],
                      ].map(([l, v], i, arr) => (
                        <tr key={l as string}>
                          <td style={{ color: HT.muted, padding: "6px 0", borderBottom: i < arr.length - 1 ? `1px solid ${HT.border}` : "none" }}>{l}</td>
                          <td style={{ textAlign: "right", color: HT.muted, borderBottom: i < arr.length - 1 ? `1px solid ${HT.border}` : "none" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={panelStyle}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, log: !c.log }))}
                  style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", cursor: "pointer" }}
                >
                  <span>Journal Log ({visible.length} entries)</span><span>{collapsed.log ? "▶" : "▼"}</span>
                </div>
                {!collapsed.log && (
                  <div style={{ maxHeight: 260, overflowY: "auto" }}>
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Date", "Net P&L", "Cum P&L", "Trades", "Win %", "Result", ""].map((h) => (
                            <th key={h} style={{ textAlign: "left", fontSize: 10, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((j, i) => (
                          <tr key={j.id}>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}` }}>{j.date}</td>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}`, color: j.netPnl >= 0 ? T.green : T.red }}>{fmt$(j.netPnl)}</td>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}`, color: k.cum[i] >= 0 ? T.green : T.red }}>{fmt$(k.cum[i])}</td>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}` }}>{j.trades}</td>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}` }}>{j.winRate ? `${j.winRate}%` : "—"}</td>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}`, color: j.netPnl >= 0 ? T.green : T.red, fontWeight: 700 }}>
                              {j.netPnl >= 0 ? "WIN" : "LOSS"}
                            </td>
                            <td style={{ padding: "5px 6px", borderBottom: `1px solid ${HT.border}`, textAlign: "right" }}>
                              <button style={{ ...btnStyle(), padding: "2px 8px", fontSize: 10 }}
                                onClick={() => setJournals((all) => all.filter((x) => x.id !== j.id))}>✕</button>
                            </td>
                          </tr>
                        ))}
                        {!visible.length && (
                          <tr><td colSpan={7} style={{ padding: 16, color: HT.muted, textAlign: "center" }}>No journal entries yet — click + New Journal.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Calendar */}
            <div style={panelStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Session Calendar</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, color: HT.muted, fontSize: 13 }}>
                  <span style={{ cursor: "pointer" }} onClick={() => setCalMonth((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}>&lt;</span>
                  <strong style={{ color: HT.text }}>{monthLabel}</strong>
                  <span style={{ cursor: "pointer" }} onClick={() => setCalMonth((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}>&gt;</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} style={{ fontSize: 10, color: HT.muted, textAlign: "center", padding: 4, textTransform: "uppercase" }}>{d}</div>
                ))}
                {calCells.map((c, i) => c ? (
                  <div key={i}
                    onClick={() => setSelectedDay(selectedDay === c.date ? null : c.date)}
                    style={{
                      minHeight: 52, border: `1px solid ${selectedDay === c.date ? HT.cyan : HT.border}`,
                      borderRadius: 4, padding: 6, cursor: "pointer",
                      background: c.pnl != null ? (c.pnl >= 0 ? `${T.green}14` : `${T.red}14`) : "transparent",
                    }}>
                    <div style={{ fontSize: 11, color: HT.muted }}>{c.day}</div>
                    {c.pnl != null && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: c.pnl >= 0 ? T.green : T.red }}>{fmt$(c.pnl)}</div>
                    )}
                  </div>
                ) : <div key={i} style={{ minHeight: 52 }} />)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* NEW JOURNAL MODAL */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setShowModal(false)}
        >
          <div style={{ background: HT.panelBgStrong, backdropFilter: "blur(16px)", maxWidth: 520, width: "95vw", borderRadius: 6, border: `1px solid ${HT.border}`, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>New Journal Entry</div>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={labelStyle}>Trading Date</label>
                <input type="date" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div><label style={labelStyle}>Net P&L ($)</label><input type="number" step="0.01" placeholder="e.g. 312.50" style={inputStyle} value={f.netPnl} onChange={(e) => setF({ ...f, netPnl: e.target.value })} /></div>
                <div><label style={labelStyle}>Total Trades</label><input type="number" step="1" min="0" placeholder="e.g. 8" style={inputStyle} value={f.trades} onChange={(e) => setF({ ...f, trades: e.target.value })} /></div>
                <div><label style={labelStyle}>Win Rate (%)</label><input type="number" step="0.1" min="0" max="100" placeholder="e.g. 62.5" style={inputStyle} value={f.winRate} onChange={(e) => setF({ ...f, winRate: e.target.value })} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div><label style={labelStyle}>Avg Win ($)</label><input type="number" step="0.01" placeholder="e.g. 187.00" style={inputStyle} value={f.avgWin} onChange={(e) => setF({ ...f, avgWin: e.target.value })} /></div>
                <div><label style={labelStyle}>Avg Loss ($)</label><input type="number" step="0.01" placeholder="e.g. -95.00" style={inputStyle} value={f.avgLoss} onChange={(e) => setF({ ...f, avgLoss: e.target.value })} /></div>
                <div><label style={labelStyle}>Profit Factor</label><input type="number" step="0.01" min="0" placeholder="e.g. 1.87" style={inputStyle} value={f.profitFactor} onChange={(e) => setF({ ...f, profitFactor: e.target.value })} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div><label style={labelStyle}>Avg MAE ($)</label><input type="number" step="0.01" placeholder="e.g. -44.00" style={inputStyle} value={f.avgMAE} onChange={(e) => setF({ ...f, avgMAE: e.target.value })} /></div>
                <div><label style={labelStyle}>Avg MFE ($)</label><input type="number" step="0.01" placeholder="e.g. 210.00" style={inputStyle} value={f.avgMFE} onChange={(e) => setF({ ...f, avgMFE: e.target.value })} /></div>
                <div><label style={labelStyle}>Commissions ($)</label><input type="number" step="0.01" placeholder="e.g. -24.00" style={inputStyle} value={f.commissions} onChange={(e) => setF({ ...f, commissions: e.target.value })} /></div>
              </div>
              <div>
                <label style={labelStyle}>Notes</label>
                <textarea rows={2} placeholder="Market conditions, key trades, observations…" style={{ ...inputStyle, resize: "vertical", minHeight: 48 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </div>
            </div>

            {modalErr && <div style={{ fontSize: 11, color: T.red, marginTop: 8 }}>{modalErr}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HT.border}` }}>
              <button style={btnStyle()} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={btnStyle(true)} onClick={saveJournal}>Save Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
