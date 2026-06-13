"use client";

/**
 * Personal · Todo — checklists, kanban board, task list, analytics.
 * Full React port of pages/old/todo.html.
 * Uses the same localStorage keys (hub_checklists / hub_pillar_titles / hub_tasks)
 * so data created in the vanilla site carries over.
 */

import { useEffect, useRef, useState } from "react";

// ── Types & defaults ──────────────────────────────────────────────────────────

interface CheckItem { id: string; text: string; checked: boolean }
interface Ticket {
  id: string; subject: string; email: string;
  category: string; priority: "LOW" | "MED" | "HIGH"; status: string;
}

type Checklists = Record<string, CheckItem[]>;
type PillarTitles = Record<string, string>;

const DEFAULT_CHECKLISTS: Checklists = {
  scott: [
    { id: "c1", text: "Drink 8 glasses of water", checked: true },
    { id: "c2", text: "10-minute morning stretch", checked: false },
    { id: "c3", text: "Write down daily goals", checked: false },
  ],
  shrills: [
    { id: "c4", text: "Review weekly workspace plan", checked: false },
    { id: "c5", text: "Draft resume updates", checked: true },
    { id: "c6", text: "Clear desktop inbox files", checked: false },
  ],
  roman: [
    { id: "c7", text: "30-minute cardio session", checked: false },
    { id: "c8", text: "Log daily calorie intake", checked: true },
    { id: "c9", text: "Prepare tomorrow's meal plan", checked: false },
  ],
  jeremy: [
    { id: "c10", text: "Read 15 pages of non-fiction", checked: false },
    { id: "c11", text: "Practice new coding framework", checked: true },
    { id: "c12", text: "Watch CSS Grid tutorial", checked: false },
  ],
  brandon: [
    { id: "c13", text: "Pay electric & water bills", checked: true },
    { id: "c14", text: "Review investment portfolio", checked: false },
    { id: "c15", text: "Organize tax deductible files", checked: false },
  ],
};

const DEFAULT_TITLES: PillarTitles = {
  scott: "Daily Habits", shrills: "Career & Work", roman: "Health & Wellness",
  jeremy: "Learning & Growth", brandon: "Life Admin & Finance",
};

const DEFAULT_TASKS: Ticket[] = [
  { id: "IDEA-001", subject: "Design backyard deck extension", email: "Home Project", category: "Personal", priority: "HIGH", status: "Ideas" },
  { id: "IDEA-002", subject: "Research itinerary for summer trip", email: "Travel Spec", category: "Learning", priority: "LOW", status: "Ideas" },
  { id: "TASK-101", subject: "Organize and tidy garage workbench", email: "Home Improvement", category: "Personal", priority: "HIGH", status: "In Progress" },
  { id: "TASK-102", subject: "Track monthly budget expenditures", email: "Life Audit", category: "Finances", priority: "MED", status: "In Progress" },
  { id: "DONE-501", subject: "Book dental checkup appointment", email: "Health Task", category: "Health", priority: "HIGH", status: "Completed" },
  { id: "DONE-502", subject: "File Q1 utility receipts", email: "Tax Preparation", category: "Finances", priority: "MED", status: "Completed" },
];

const BOXES = [
  { key: "scott", color: "#7c4dff" },
  { key: "shrills", color: "#ffb300" },
  { key: "roman", color: "#00e676" },
  { key: "jeremy", color: "#29b6f6" },
  { key: "brandon", color: "#ff4757" },
];

const STATUS_COLORS: Record<string, string> = {
  Ideas: "#7c4dff", "In Progress": "#ffb300", Completed: "#00e676",
};

const CATEGORIES = ["Personal", "Career", "Health", "Learning", "Finances"];
const STATUSES = ["Ideas", "In Progress", "Completed"];

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const C = {
  bg0: "#080c10", bg1: "#0d1117", bg2: "#111822", bg3: "#1a2233", bg4: "#1f2d42",
  border: "#1e3050", border2: "#2a4060",
  text0: "#e8edf5", text1: "#a8b8cc", text2: "#5a7a99", text3: "#3a5570",
  green: "#00e676", green2: "#1fae5e", red: "#ff4757", red2: "#cc2233",
  amber: "#ffb300", cyan: "#00e5ff", purple: "#7c4dff",
};

const btnBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px",
  fontFamily: "Arial, sans-serif", fontSize: 11, fontWeight: 600,
  letterSpacing: ".08em", textTransform: "uppercase",
  border: "none", borderRadius: 2, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: "#0d6fa0", color: "#fff" };
const btnGhost: React.CSSProperties = { ...btnBase, background: "transparent", color: C.text1, border: `1px solid ${C.border2}` };
const btnDanger: React.CSSProperties = { ...btnBase, background: C.red2, color: C.red, border: "1px solid #ff475744" };

const formLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: ".1em",
};
const formInput: React.CSSProperties = {
  background: C.bg0, border: `1px solid ${C.border2}`, padding: "8px 10px",
  borderRadius: 2, color: C.text0, fontFamily: "Arial, sans-serif", fontSize: 13,
  outline: "none", width: "100%", colorScheme: "dark",
};
const formGroup: React.CSSProperties = { marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 };

function PBadge({ p }: { p: string }) {
  const styles: Record<string, React.CSSProperties> = {
    HIGH: { background: "#2a0a0a", color: C.red, border: "1px solid #ff475744" },
    MED: { background: "#2a1a00", color: C.amber, border: "1px solid #ffb30044" },
    LOW: { background: C.bg3, color: C.text2, border: `1px solid ${C.border2}` },
  };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 2,
      textTransform: "uppercase", letterSpacing: ".08em", ...styles[p],
    }}>
      {p}
    </span>
  );
}

// Static weekly trend from the vanilla page
const TREND = [1, 2, 0, 3, 2, 4, 3];
const TREND_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function TrendChart() {
  const w = 900, h = 340, padL = 40, padB = 30, padT = 16, padR = 16;
  const maxV = Math.max(...TREND, 1);
  const x = (i: number) => padL + ((w - padL - padR) * i) / (TREND.length - 1);
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / maxV);
  const path = TREND.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = `${path} L${x(TREND.length - 1)},${h - padB} L${x(0)},${h - padB} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 360 }}>
      {[0, 1, 2, 3, 4].map((g) => {
        const gy = padT + ((h - padT - padB) * g) / 4;
        const val = maxV - (maxV * g) / 4;
        return (
          <g key={g}>
            <line x1={padL} y1={gy} x2={w - padR} y2={gy} stroke="rgba(30,48,80,0.6)" />
            <text x={padL - 8} y={gy + 4} textAnchor="end" fontSize={11} fill={C.text3} fontFamily="Arial">{val.toFixed(0)}</text>
          </g>
        );
      })}
      <path d={area} fill="rgba(0,229,255,0.06)" />
      <path d={path} fill="none" stroke={C.cyan} strokeWidth={2} />
      {TREND.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={4} fill={C.cyan} />
          <text x={x(i)} y={h - 8} textAnchor="middle" fontSize={11} fill={C.text3} fontFamily="Arial">{TREND_LABELS[i]}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TodoPage() {
  const [hydrated, setHydrated] = useState(false);
  const [checklists, setChecklists] = useState<Checklists>(DEFAULT_CHECKLISTS);
  const [titles, setTitles] = useState<PillarTitles>(DEFAULT_TITLES);
  const [tickets, setTickets] = useState<Ticket[]>(DEFAULT_TASKS);
  const [section, setSection] = useState("todo");
  const [view, setView] = useState("overview");
  const [editId, setEditId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Edit modal fields
  const [eTitle, setETitle] = useState(""); const [eDetails, setEDetails] = useState("");
  const [eCat, setECat] = useState("Personal"); const [ePri, setEPri] = useState("LOW");
  const [eStatus, setEStatus] = useState("Ideas");

  // Create modal fields
  const [cTitle, setCTitle] = useState(""); const [cType, setCType] = useState("checklist");
  const [cBox, setCBox] = useState("scott"); const [cCat, setCCat] = useState("Personal");
  const [cPri, setCPri] = useState("LOW"); const [cStatus, setCStatus] = useState("Ideas");

  const inlineRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    setChecklists(loadLS("hub_checklists", DEFAULT_CHECKLISTS));
    setTitles(loadLS("hub_pillar_titles", DEFAULT_TITLES));
    setTickets(loadLS("hub_tasks", DEFAULT_TASKS));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("hub_checklists", JSON.stringify(checklists));
      localStorage.setItem("hub_pillar_titles", JSON.stringify(titles));
      localStorage.setItem("hub_tasks", JSON.stringify(tickets));
    } catch { /* unavailable */ }
  }, [hydrated, checklists, titles, tickets]);

  // ── Mutations (ported) ───────────────────────────────────────────────────────
  const toggleCheck = (key: string, id: string) =>
    setChecklists((c) => ({ ...c, [key]: c[key].map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)) }));

  const deleteItem = (key: string, id: string) =>
    setChecklists((c) => ({ ...c, [key]: c[key].filter((i) => i.id !== id) }));

  const renameItem = (key: string, id: string, text: string) => {
    const v = text.trim();
    if (!v) return;
    setChecklists((c) => ({ ...c, [key]: c[key].map((i) => (i.id === id ? { ...i, text: v } : i)) }));
  };

  const renamePillar = (key: string, text: string) => {
    const v = text.trim();
    if (v) setTitles((t) => ({ ...t, [key]: v }));
  };

  const inlineAdd = (key: string) => {
    const el = inlineRefs.current[key];
    const text = el?.value.trim();
    if (!text) return;
    setChecklists((c) => ({ ...c, [key]: [...c[key], { id: "c_" + Date.now(), text, checked: false }] }));
    if (el) el.value = "";
  };

  const deleteTask = (id: string) => setTickets((t) => t.filter((x) => x.id !== id));

  const openTicket = (id: string) => {
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    setEditId(id);
    setETitle(t.subject); setEDetails(t.email); setECat(t.category);
    setEPri(t.priority); setEStatus(t.status);
  };

  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    setTickets((all) => all.map((t) => t.id === editId
      ? { ...t, subject: eTitle.trim(), email: eDetails.trim(), category: eCat, priority: ePri as Ticket["priority"], status: eStatus }
      : t));
    setEditId(null);
  };

  const createItem = (e: React.FormEvent) => {
    e.preventDefault();
    const title = cTitle.trim();
    if (!title) return;
    if (cType === "checklist") {
      setChecklists((c) => ({ ...c, [cBox]: [...c[cBox], { id: "c_" + Date.now(), text: title, checked: false }] }));
    } else {
      const prefix = cStatus === "Completed" ? "DONE" : cStatus === "In Progress" ? "TASK" : "IDEA";
      const rand = Math.floor(100 + Math.random() * 900);
      setTickets((t) => [...t, {
        id: `${prefix}-${rand}`, subject: title, email: "Personal Goal",
        category: cCat, priority: cPri as Ticket["priority"], status: cStatus,
      }]);
    }
    setCTitle(""); setShowCreate(false);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const ideas = tickets.filter((t) => t.status === "Ideas").length;
  const prog = tickets.filter((t) => t.status === "In Progress").length;
  const done = tickets.filter((t) => t.status === "Completed").length;
  let total = 0, checked = 0;
  Object.values(checklists).forEach((l) => l.forEach((i) => { total++; if (i.checked) checked++; }));
  const pct = total > 0 ? Math.round((checked / total) * 100) : 100;

  // ── Render pieces ─────────────────────────────────────────────────────────────
  const Board = () => (
    <div style={{ display: "flex", gap: 16, minHeight: 400, paddingBottom: 20 }}>
      {STATUSES.map((status) => {
        const cols = tickets.filter((t) => t.status === status);
        return (
          <div key={status} style={{
            flex: 1, display: "flex", flexDirection: "column", background: C.bg1,
            border: `1px solid ${C.border}`, borderRadius: 2, minWidth: 260,
          }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: STATUS_COLORS[status] }} />
              <span style={{ fontSize: 10, fontWeight: 700, flex: 1, textTransform: "uppercase", letterSpacing: ".1em", color: C.text1 }}>{status}</span>
              <span style={{ fontSize: 10, background: C.bg3, border: `1px solid ${C.border2}`, padding: "1px 7px", borderRadius: 2, fontWeight: 600, color: C.text2 }}>{cols.length}</span>
            </div>
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
              {cols.map((t) => (
                <div key={t.id} onClick={() => openTicket(t.id)} style={{
                  background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 2,
                  padding: 12, cursor: "pointer",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: C.text3, fontWeight: 700, letterSpacing: ".05em", fontFamily: "monospace" }}>{t.id}</span>
                    <PBadge p={t.priority} />
                  </div>
                  <div style={{ fontSize: 12, color: C.text0, fontWeight: 600, lineHeight: 1.4, margin: "6px 0 10px" }}>{t.subject}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <span style={{ fontSize: 10, color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{t.email}</span>
                    <span style={{ fontSize: 10, color: C.text2, background: C.bg3, border: `1px solid ${C.border2}`, borderRadius: 2, padding: "1px 7px", fontWeight: 600 }}>{t.category}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const vtab = (id: string, label: string) => (
    <div key={id} onClick={() => setView(id)} style={{
      padding: "0 14px", height: "100%", fontSize: 11, fontWeight: 600,
      letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer",
      color: view === id ? C.cyan : C.text2,
      borderBottom: `2px solid ${view === id ? C.cyan : "transparent"}`,
      display: "flex", alignItems: "center",
    }}>
      {label}
    </div>
  );

  const sectionTab = (id: string, label: string) => (
    <button key={id} onClick={() => setSection(id)} style={{
      height: 30, padding: "0 12px",
      border: `1px solid ${section === id ? "#00e5ff66" : C.border2}`,
      background: section === id ? C.bg4 : "transparent",
      color: section === id ? C.cyan : C.text2,
      fontFamily: "Arial, sans-serif", fontSize: 10, fontWeight: 700,
      letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer",
    }}>
      {label}
    </button>
  );

  const metricCard = (label: string, value: React.ReactNode, sub: React.ReactNode, color?: string) => (
    <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 2, padding: "12px 16px" }}>
      <div style={{ fontSize: 10, color: C.text3, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".12em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? C.text0, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{sub}</div>
    </div>
  );

  const modalOverlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, backdropFilter: "blur(4px)",
  };
  const modalBox: React.CSSProperties = {
    background: C.bg1, width: "100%", maxWidth: 480, borderRadius: 2,
    padding: 24, border: `1px solid ${C.border2}`,
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
      background: C.bg0, color: C.text0, fontFamily: "Arial, sans-serif", fontSize: 14, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        background: C.bg1, borderBottom: `1px solid ${C.border}`, padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 32, flexShrink: 0, height: 52,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".1em" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.cyan }} />
          Personal · Todo
        </div>

        <div style={{ display: "flex", gap: 4, height: "100%", alignItems: "center" }}>
          {sectionTab("budget", "Budget")}
          {sectionTab("todo", "Todo")}
          {sectionTab("trading", "Trading")}
          {sectionTab("personal", "Personal")}
        </div>

        <div style={{ display: "flex", gap: 0, height: "100%", alignItems: "center", visibility: section === "todo" ? "visible" : "hidden" }}>
          {vtab("overview", "Overview")}
          {vtab("kanban", "Board")}
          {vtab("list", "All Tasks")}
          {vtab("reports", "Analytics")}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, visibility: section === "todo" ? "visible" : "hidden" }}>
          <button style={btnPrimary} onClick={() => setShowCreate(true)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Item
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minHeight: 0 }}>
        {section !== "todo" ? (
          <div style={{
            height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            color: C.text3, fontSize: 12, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase",
          }}>
            {section.charAt(0).toUpperCase() + section.slice(1)}
          </div>
        ) : (
          <div style={{ maxWidth: 1600, margin: "0 auto" }}>
            {/* OVERVIEW */}
            {view === "overview" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                  {metricCard("Ideas", ideas, "Pending review", C.purple)}
                  {metricCard("In Progress", prog, "Active tasks", C.amber)}
                  {metricCard("Completed", done, "Shipped", C.green)}
                  {metricCard("Daily Progress",
                    <>{pct}<span style={{ fontSize: 14, color: C.text2 }}>%</span></>,
                    <span style={{ color: C.green2 }}>{checked} / {total} habits</span>)}
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".12em", color: C.text3, marginBottom: 12 }}>Checklists</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
                  {BOXES.map((box) => {
                    const items = checklists[box.key] ?? [];
                    return (
                      <div key={box.key} style={{
                        background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 2,
                        padding: 16, display: "flex", flexDirection: "column",
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: C.text0, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: box.color }} />
                          <span
                            contentEditable suppressContentEditableWarning
                            onBlur={(e) => renamePillar(box.key, e.currentTarget.innerText)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                            style={{ cursor: "pointer", outline: "none" }}
                          >
                            {titles[box.key]}
                          </span>
                        </div>
                        <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, flexGrow: 1 }}>
                          {items.length ? items.map((item) => (
                            <li key={item.id} style={{
                              display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8,
                              fontSize: 12, color: C.text1, lineHeight: 1.4, justifyContent: "space-between",
                            }}>
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexGrow: 1 }}>
                                <input type="checkbox" checked={item.checked}
                                  onChange={() => toggleCheck(box.key, item.id)}
                                  style={{ marginTop: 2, flexShrink: 0, width: 13, height: 13, cursor: "pointer", accentColor: C.cyan }} />
                                <span
                                  contentEditable suppressContentEditableWarning
                                  onBlur={(e) => renameItem(box.key, item.id, e.currentTarget.innerText)}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                                  style={{
                                    outline: "none", cursor: "pointer", flexGrow: 1,
                                    textDecoration: item.checked ? "line-through" : "none",
                                    color: item.checked ? C.text3 : C.text1,
                                  }}
                                >
                                  {item.text}
                                </span>
                              </div>
                              <button onClick={() => deleteItem(box.key, item.id)} style={{
                                background: "none", border: "none", color: C.text3, cursor: "pointer",
                                fontSize: 14, lineHeight: 1, padding: "0 2px",
                              }}>×</button>
                            </li>
                          )) : (
                            <li style={{ color: C.text3, fontStyle: "italic", fontSize: 11 }}>No items yet</li>
                          )}
                        </ul>
                        <div style={{ display: "flex", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: "auto" }}>
                          <input
                            ref={(el) => { inlineRefs.current[box.key] = el; }}
                            type="text" placeholder="Add item..."
                            onKeyDown={(e) => { if (e.key === "Enter") inlineAdd(box.key); }}
                            style={{
                              flex: 1, background: C.bg0, border: `1px solid ${C.border2}`, borderRadius: 2,
                              padding: "5px 8px", fontSize: 11, color: C.text0, fontFamily: "Arial, sans-serif", outline: "none",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".12em", color: C.text3, marginBottom: 12, marginTop: 8 }}>Active Goals Board</div>
                <Board />
              </>
            )}

            {/* KANBAN */}
            {view === "kanban" && <Board />}

            {/* LIST */}
            {view === "list" && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.bg2, borderBottom: `2px solid ${C.border2}` }}>
                    {["Task / Idea", "Category", "Priority", "Status", "Actions"].map((h, i) => (
                      <th key={h} style={{
                        padding: "8px 12px", textAlign: i === 4 ? "right" : "left", fontSize: 10,
                        letterSpacing: ".12em", textTransform: "uppercase", color: C.text3, fontWeight: 600, whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} onClick={() => openTicket(t.id)} style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
                      <td style={{ padding: "8px 12px", color: C.text0, fontWeight: 600, whiteSpace: "nowrap" }}>{t.subject}</td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 10, color: C.text2, background: C.bg3, border: `1px solid ${C.border2}`, borderRadius: 2, padding: "1px 7px", fontWeight: 600 }}>{t.category}</span>
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}><PBadge p={t.priority} /></td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[t.status] }} />
                          <span style={{ color: C.text1, fontSize: 12 }}>{t.status}</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button style={{ ...btnGhost, fontSize: 10, padding: "3px 8px" }}
                          onClick={(e) => { e.stopPropagation(); deleteTask(t.id); }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* ANALYTICS */}
            {view === "reports" && (
              <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: C.text1, marginBottom: 20 }}>
                  Completed Tasks — Weekly Trend
                </div>
                <TrendChart />
              </div>
            )}
          </div>
        )}
      </div>

      {/* EDIT MODAL */}
      {editId && (
        <div style={modalOverlay} onClick={() => setEditId(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", margin: 0 }}>Edit Task</h2>
              <button onClick={() => setEditId(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.text3, lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={saveEdit}>
              <div style={formGroup}><label style={formLabel}>Title</label>
                <input style={formInput} value={eTitle} onChange={(e) => setETitle(e.target.value)} required /></div>
              <div style={formGroup}><label style={formLabel}>Details</label>
                <input style={formInput} value={eDetails} onChange={(e) => setEDetails(e.target.value)} placeholder="Subtitle or notes..." /></div>
              <div style={formGroup}><label style={formLabel}>Category</label>
                <select style={formInput} value={eCat} onChange={(e) => setECat(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></div>
              <div style={formGroup}><label style={formLabel}>Priority</label>
                <select style={formInput} value={ePri} onChange={(e) => setEPri(e.target.value)}>
                  <option value="LOW">Low</option><option value="MED">Medium</option><option value="HIGH">High</option>
                </select></div>
              <div style={formGroup}><label style={formLabel}>Status</label>
                <select style={formInput} value={eStatus} onChange={(e) => setEStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select></div>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button type="button" style={btnDanger} onClick={() => { if (editId) deleteTask(editId); setEditId(null); }}>Delete</button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={btnGhost} onClick={() => setEditId(null)}>Cancel</button>
                  <button type="submit" style={btnPrimary}>Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={modalOverlay} onClick={() => setShowCreate(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", margin: 0 }}>Add New Item</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.text3, lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={createItem}>
              <div style={formGroup}><label style={formLabel}>Title</label>
                <input style={formInput} value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="e.g. Review portfolio" required /></div>
              <div style={formGroup}><label style={formLabel}>Type</label>
                <select style={formInput} value={cType} onChange={(e) => setCType(e.target.value)}>
                  <option value="checklist">Checklist Item</option>
                  <option value="board">Board Task</option>
                </select></div>
              {cType === "checklist" ? (
                <div style={formGroup}><label style={formLabel}>Target List</label>
                  <select style={formInput} value={cBox} onChange={(e) => setCBox(e.target.value)}>
                    {BOXES.map((b) => <option key={b.key} value={b.key}>{titles[b.key]}</option>)}
                  </select></div>
              ) : (
                <>
                  <div style={formGroup}><label style={formLabel}>Category</label>
                    <select style={formInput} value={cCat} onChange={(e) => setCCat(e.target.value)}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select></div>
                  <div style={formGroup}><label style={formLabel}>Priority</label>
                    <select style={formInput} value={cPri} onChange={(e) => setCPri(e.target.value)}>
                      <option value="LOW">Low</option><option value="MED">Medium</option><option value="HIGH">High</option>
                    </select></div>
                  <div style={formGroup}><label style={formLabel}>Status</label>
                    <select style={formInput} value={cStatus} onChange={(e) => setCStatus(e.target.value)}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select></div>
                </>
              )}
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" style={btnGhost} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" style={btnPrimary}>Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
