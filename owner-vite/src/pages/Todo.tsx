/**
 * Personal · Todo — four checklists + one drag-and-drop Checklist Update board.
 *
 * ONE page, one source of truth. Every checklist item carries its own board
 * `status`, so the three Checklist Update columns are a VIEW of the checklists
 * rather than a second list that has to be kept in sync:
 *
 *   checklists  → WORK · FAMILY · IDEAS · WEEKLY GOALS
 *   board       → All Todo · In Progress · Completed   (grouped by item.status)
 *
 * A new checklist item is born in "All Todo". Dragging its card between columns
 * writes back to the item it came from, and Completed ⇔ the checkbox — tick the
 * box and the card lands in Completed, drag it out and the box clears.
 *
 * Storage is POSTGRES, via /api/owner/todo (owner_todo_item + owner_todo_list).
 * It was localStorage-only, which meant the board existed on exactly one
 * browser on one machine and vanished with a cleared cache. localStorage is
 * still written, but only as an offline cache and as the one-time migration
 * source for a board that predates the table — the database is the truth.
 *
 * The whole document is saved on a debounce rather than a request per gesture:
 * every mutation here rewrites one object, so per-gesture calls would race each
 * other over the same ordering.
 *
 * The v1 keys (hub_checklists / hub_pillar_titles / hub_tasks) are left
 * untouched on purpose — the old five-pillar shape doesn't map onto these four
 * lists, so the old data is preserved rather than half-migrated.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  OWNER_THEME as HOME_THEME_BASE,
  homeButtonStyle,
  homeContentStyle,
  homeHeaderStyle,
  homeInputStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
} from "../lib/theme";
import { ThemedSelect } from "../components/ThemedSelect";

// Page override — budget theme (see BUDGET_UI_STYLE.md): single light-blue accent,
// no rotating card colors, no top bars.
const LIGHT_BLUE = "#7dd3fc";
const HOME_THEME = {
  ...HOME_THEME_BASE,
  muted: "#FFFFFF",
  cyan: LIGHT_BLUE,  // single accent (light blue)
  purple: "#126783", // Ideas → deep teal
  green: "#8ECAE6",  // light blue (Completed)
  orange: "#FB8501", // orange
};

// Budget card surface: frosted panel + faint light-blue radial highlight (no top bar).
const budgetRadial = HOME_THEME_BASE.panelBg;

// ── Types & defaults ──────────────────────────────────────────────────────────

type Status = "All Todo" | "In Progress" | "Completed";

interface CheckItem {
  id: string;
  text: string;
  checked: boolean;
  status: Status;
}

type Checklists = Record<string, CheckItem[]>;
type PillarTitles = Record<string, string>;

const BOXES = [
  { key: "work", color: HOME_THEME.cyan },
  { key: "family", color: HOME_THEME.orange },
  { key: "ideas", color: HOME_THEME.purple },
  { key: "weekly", color: HOME_THEME.green },
];

const DEFAULT_TITLES: PillarTitles = {
  work: "Work", family: "Family", ideas: "Ideas", weekly: "Weekly Goals",
};

const DEFAULT_CHECKLISTS: Checklists = { work: [], family: [], ideas: [], weekly: [] };

const STATUSES: Status[] = ["All Todo", "In Progress", "Completed"];
const STATUS_COLORS: Record<Status, string> = {
  "All Todo": HOME_THEME.cyan,
  "In Progress": HOME_THEME.orange,
  Completed: HOME_THEME.green,
};

const LS_LISTS = "hub_checklists_v2";
const LS_TITLES = "hub_pillar_titles_v2";

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

/**
 * Anything read back from localStorage predates the current shape by definition
 * — items written before `status` existed, or a list key that no longer exists.
 * Normalize on read so the board never has to defend against a missing status.
 */
function normalizeLists(raw: unknown): Checklists {
  const out: Checklists = { work: [], family: [], ideas: [], weekly: [] };
  if (!raw || typeof raw !== "object") return out;
  for (const box of BOXES) {
    const list = (raw as Record<string, unknown>)[box.key];
    if (!Array.isArray(list)) continue;
    out[box.key] = list
      .filter((i) => i && typeof i === "object")
      .map((i) => {
        const it = i as Partial<CheckItem>;
        const checked = !!it.checked;
        const status: Status = STATUSES.includes(it.status as Status)
          ? (it.status as Status)
          : (checked ? "Completed" : "All Todo");
        return {
          id: String(it.id ?? "c_" + Math.random().toString(36).slice(2)),
          text: String(it.text ?? ""),
          checked: status === "Completed" ? true : checked,
          status,
        };
      })
      .filter((i) => i.text.trim().length > 0);
  }
  return out;
}

// ── Shared styles (HOME_THEME-based) ───────────────────────────────────────────

const formLabel: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: ".1em",
};
const formInput: React.CSSProperties = {
  ...homeInputStyle, width: "100%", fontSize: 14, colorScheme: "dark",
};
const formGroup: React.CSSProperties = { marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 };

const btnBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
const btnPrimary: React.CSSProperties = { ...homeButtonStyle, ...btnBase };
const btnGhost: React.CSSProperties = { ...homeSecondaryButtonStyle, ...btnBase };

function SectionTitle({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: accent }}>
      <span style={{ width: 14, height: 2, borderRadius: 2, background: accent, boxShadow: `0 0 6px ${rgba(accent, 0.6)}` }} />
      {text}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

/** The board as the API carries it: flat, ordered, list tagged per item. */
type WireItem = { id: string; listKey: string; text: string; checked: boolean; status: Status };

function flatten(lists: Checklists): WireItem[] {
  return BOXES.flatMap((b) =>
    (lists[b.key] ?? []).map((i) => ({ id: i.id, listKey: b.key, text: i.text, checked: i.checked, status: i.status })),
  );
}
function unflatten(items: WireItem[]): Checklists {
  const out: Checklists = { work: [], family: [], ideas: [], weekly: [] };
  for (const i of items) {
    if (!out[i.listKey]) continue;
    const status: Status = STATUSES.includes(i.status) ? i.status : i.checked ? "Completed" : "All Todo";
    out[i.listKey].push({ id: i.id, text: String(i.text ?? ""), checked: status === "Completed" ? true : !!i.checked, status });
  }
  return out;
}

export default function Todo() {
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [checklists, setChecklists] = useState<Checklists>(DEFAULT_CHECKLISTS);
  const [titles, setTitles] = useState<PillarTitles>(DEFAULT_TITLES);
  const [showCreate, setShowCreate] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cBox, setCBox] = useState("work");

  // Drag state: which item is in flight, and which column it is hovering.
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);

  const inlineRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** The last body successfully written, so an unchanged board never re-posts. */
  const lastSaved = useRef<string | null>(null);
  /** A read failed — the screen is the local cache and must not be saved up. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** The pre-database local board is being adopted into Postgres. */
  const [migrating, setMigrating] = useState(false);

  /**
   * Load from Postgres, falling back to the local cache.
   *
   * A first load that comes back EMPTY while localStorage still holds a board
   * is the pre-database state: the local copy is adopted and pushed up once.
   * That check is `items.length === 0` and nothing else — a genuinely emptied
   * board with nothing in localStorage stays empty, and a board that already
   * exists server-side always wins.
   */
  useEffect(() => {
    let dead = false;
    (async () => {
      const cachedLists = normalizeLists(loadLS<unknown>(LS_LISTS, null));
      const cachedTitles = { ...DEFAULT_TITLES, ...loadLS<PillarTitles>(LS_TITLES, {}) };
      try {
        const res = await fetch("/api/owner/todo", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (dead) return;
        const items: WireItem[] = Array.isArray(data?.items) ? data.items : [];
        const serverTitles = data?.titles && typeof data.titles === "object" ? data.titles : {};
        const cachedCount = BOXES.reduce((n, b) => n + (cachedLists[b.key]?.length ?? 0), 0);
        if (items.length === 0 && cachedCount > 0) {
          // Adopt the local board and let the save effect below write it up.
          setChecklists(cachedLists);
          setTitles(cachedTitles);
          setMigrating(true);
        } else {
          setChecklists(unflatten(items));
          setTitles({ ...DEFAULT_TITLES, ...serverTitles });
        }
      } catch {
        // Offline or the endpoint is down. Show the cache and DON'T save over
        // the database with it — saving is gated on a load having succeeded.
        if (dead) return;
        setChecklists(cachedLists);
        setTitles(cachedTitles);
        setLoadFailed(true);
      } finally {
        if (!dead) setHydrated(true);
      }
    })();
    return () => { dead = true; };
  }, []);

  /**
   * Save on a debounce. Gated on `loadFailed` being false: writing the local
   * cache over the database after a failed read is how a board gets silently
   * rolled back to whatever the last-used browser happened to hold.
   */
  useEffect(() => {
    if (!hydrated || loadFailed) return;
    // localStorage stays current regardless — it is the offline cache, and it
    // costs nothing to keep it honest.
    try {
      localStorage.setItem(LS_LISTS, JSON.stringify(checklists));
      localStorage.setItem(LS_TITLES, JSON.stringify(titles));
    } catch { /* private mode — the database is still the truth */ }

    const body = JSON.stringify({ items: flatten(checklists), titles });
    if (body === lastSaved.current) return;
    const t = setTimeout(() => {
      setSaveState("saving");
      fetch("/api/owner/todo", { method: "POST", headers: { "Content-Type": "application/json" }, body })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          lastSaved.current = body;
          setMigrating(false);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 600);
    return () => clearTimeout(t);
  }, [hydrated, loadFailed, checklists, titles]);

  // The browser's own guard, for the 600ms a change has not reached Postgres.
  useEffect(() => {
    if (saveState !== "saving" && saveState !== "error") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  /** Apply a patch to one item wherever it lives, without knowing its list. */
  const patchItem = (id: string, patch: (i: CheckItem) => CheckItem) =>
    setChecklists((c) => {
      const next: Checklists = {};
      for (const k of Object.keys(c)) next[k] = c[k].map((i) => (i.id === id ? patch(i) : i));
      return next;
    });

  /** Checkbox ⇔ Completed column. Unticking returns the card to All Todo. */
  const toggleCheck = (id: string) =>
    patchItem(id, (i) => {
      const checked = !i.checked;
      return { ...i, checked, status: checked ? "Completed" : "All Todo" };
    });

  /** Drop target. Landing in Completed ticks the box; leaving it clears the box. */
  const moveItem = (id: string, status: Status) =>
    patchItem(id, (i) => (i.status === status ? i : { ...i, status, checked: status === "Completed" }));

  const deleteItem = (key: string, id: string) =>
    setChecklists((c) => ({ ...c, [key]: (c[key] ?? []).filter((i) => i.id !== id) }));

  const deleteAnywhere = (id: string) =>
    setChecklists((c) => {
      const next: Checklists = {};
      for (const k of Object.keys(c)) next[k] = c[k].filter((i) => i.id !== id);
      return next;
    });

  const renameItem = (key: string, id: string, text: string) => {
    const v = text.trim();
    if (!v) return;
    setChecklists((c) => ({ ...c, [key]: (c[key] ?? []).map((i) => (i.id === id ? { ...i, text: v } : i)) }));
  };

  const renamePillar = (key: string, text: string) => {
    const v = text.trim();
    if (v) setTitles((t) => ({ ...t, [key]: v }));
  };

  /** Every new item starts life in the first Checklist Update column. */
  const addItem = (key: string, text: string) => {
    const v = text.trim();
    if (!v) return;
    const item: CheckItem = { id: "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: v, checked: false, status: "All Todo" };
    setChecklists((c) => ({ ...c, [key]: [...(c[key] ?? []), item] }));
  };

  const inlineAdd = (key: string) => {
    const el = inlineRefs.current[key];
    const text = el?.value ?? "";
    if (!text.trim()) return;
    addItem(key, text);
    if (el) el.value = "";
  };

  const createItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cTitle.trim()) return;
    addItem(cBox, cTitle);
    setCTitle(""); setShowCreate(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  /** Flat view of every item, tagged with the list it came from. */
  const allItems = useMemo(
    () => BOXES.flatMap((b) => (checklists[b.key] ?? []).map((i) => ({ ...i, boxKey: b.key, boxColor: b.color }))),
    [checklists],
  );
  const total = allItems.length;
  const checked = allItems.filter((i) => i.checked).length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 100;

  const modalOverlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, backdropFilter: "blur(4px)",
  };
  const modalBox: React.CSSProperties = { ...homePanelStyle, width: "100%", maxWidth: 480, padding: 24 };

  return (
    <div style={homeShellStyle}>
      <style>{`
        .conf-hover{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;}
        .conf-hover:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.35);border-color:${rgba(HOME_THEME.cyan, 0.35)};}
        .cu-card{cursor:grab;}
        .cu-card:active{cursor:grabbing;}
        .cu-card.dragging{opacity:.4;}
      `}</style>

      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".12em", color: HOME_THEME.cyan }}>Personal · To-Do</span>
          <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.85, fontFamily: "var(--font-mono)" }}>
            {checked}/{total} done · {pct}%
          </span>
          {/* Where the board lives, said out loud. It used to be this browser
              only, so "is this actually saved" is a fair question to answer on
              screen rather than in a tooltip. */}
          <span
            title={
              loadFailed
                ? "Could not reach the database — you are looking at this browser's cached copy and nothing is being saved."
                : "Saved to Postgres, so the board is the same on every device."
            }
            style={{
              fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase",
              padding: "3px 9px", borderRadius: 999,
              border: `1px solid ${rgba(
                loadFailed || saveState === "error" ? HOME_THEME.orange : HOME_THEME.cyan,
                0.45,
              )}`,
              color: loadFailed || saveState === "error" ? HOME_THEME.orange : HOME_THEME.cyan,
              opacity: 0.9,
            }}
          >
            {loadFailed
              ? "Offline · cached"
              : saveState === "error"
                ? "Save failed"
                : saveState === "saving"
                  ? migrating ? "Moving to database…" : "Saving…"
                  : "Saved"}
          </span>
        </div>
        <button style={btnPrimary} onClick={() => setShowCreate(true)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Item
        </button>
      </div>

      {/* Content */}
      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        {/* CHECKLISTS — four fixed lists */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle text="Checklists" accent={HOME_THEME.cyan} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
            {BOXES.map((box) => {
              const items = checklists[box.key] ?? [];
              return (
                <div key={box.key} className="conf-hover" style={{
                  ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column",
                  background: budgetRadial,
                }}>
                  <div style={{ fontSize: 17, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em", color: HOME_THEME.text, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: box.color, boxShadow: `0 0 8px ${rgba(box.color, 0.7)}` }} />
                    <span
                      contentEditable suppressContentEditableWarning
                      onBlur={(e) => renamePillar(box.key, e.currentTarget.innerText)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                      style={{ cursor: "pointer", outline: "none", flex: 1 }}
                    >
                      {titles[box.key]}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.muted, opacity: 0.7 }}>{items.length}</span>
                  </div>
                  <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, flexGrow: 1 }}>
                    {items.length ? items.map((item) => (
                      <li key={item.id} style={{
                        display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8,
                        fontSize: 14, color: HOME_THEME.text, lineHeight: 1.4, justifyContent: "space-between",
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexGrow: 1 }}>
                          <input type="checkbox" checked={item.checked}
                            onChange={() => toggleCheck(item.id)}
                            style={{ marginTop: 2, flexShrink: 0, width: 13, height: 13, cursor: "pointer", accentColor: HOME_THEME.cyan }} />
                          <span
                            contentEditable suppressContentEditableWarning
                            onBlur={(e) => renameItem(box.key, item.id, e.currentTarget.innerText)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                            style={{
                              outline: "none", cursor: "pointer", flexGrow: 1,
                              textDecoration: item.checked ? "line-through" : "none",
                              color: item.checked ? HOME_THEME.muted : HOME_THEME.text,
                              opacity: item.checked ? 0.6 : 1,
                            }}
                          >
                            {item.text}
                          </span>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
                          whiteSpace: "nowrap", padding: "1px 6px", borderRadius: 4, marginTop: 1,
                          color: STATUS_COLORS[item.status],
                          background: rgba(STATUS_COLORS[item.status], 0.12),
                          border: `1px solid ${rgba(STATUS_COLORS[item.status], 0.35)}`,
                        }}>{item.status}</span>
                        <button onClick={() => deleteItem(box.key, item.id)} style={{
                          background: "none", border: "none", color: HOME_THEME.muted, cursor: "pointer",
                          fontSize: 14, lineHeight: 1, padding: "0 2px",
                        }}>×</button>
                      </li>
                    )) : (
                      <li style={{ color: HOME_THEME.muted, fontStyle: "italic", fontSize: 14, opacity: 0.6 }}>No items yet</li>
                    )}
                  </ul>
                  <div style={{ display: "flex", gap: 6, borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 10, marginTop: "auto" }}>
                    <input
                      ref={(el) => { inlineRefs.current[box.key] = el; }}
                      type="text" placeholder="Add item..."
                      onKeyDown={(e) => { if (e.key === "Enter") inlineAdd(box.key); }}
                      style={{ ...homeInputStyle, flex: 1, fontSize: 14, padding: "5px 8px" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CHECKLIST UPDATE — three drag-and-drop columns over the same items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle text="Checklist Update" accent={HOME_THEME.cyan} />
          <div style={{ display: "flex", gap: 16, minHeight: 400, paddingBottom: 4, flexWrap: "wrap" }}>
            {STATUSES.map((status) => {
              const cards = allItems.filter((t) => t.status === status);
              const col = STATUS_COLORS[status];
              const isOver = overCol === status;
              return (
                <div
                  key={status}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overCol !== status) setOverCol(status); }}
                  onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragId.current;
                    if (id) moveItem(id, status);
                    dragId.current = null; setDragging(null); setOverCol(null);
                  }}
                  style={{
                    ...homePanelStyle, flex: 1, display: "flex", flexDirection: "column", minWidth: 260,
                    background: budgetRadial,
                    // Drop affordance rides on box-shadow, not borderColor — the panel's
                    // `border` shorthand comes in from homePanelStyle and React warns when
                    // a longhand is toggled against a shorthand between renders.
                    boxShadow: isOver ? `inset 0 0 0 2px ${rgba(col, 0.55)}, 0 0 18px ${rgba(col, 0.18)}` : undefined,
                    transition: "box-shadow .12s ease",
                  }}
                >
                  <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${HOME_THEME.border}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: col, boxShadow: `0 0 8px ${rgba(col, 0.7)}` }} />
                    <span style={{ fontSize: 17, fontWeight: 800, flex: 1, textTransform: "uppercase", letterSpacing: ".1em", color: col }}>{status}</span>
                    <span style={{ fontSize: 14, background: "rgba(255,255,255,0.05)", border: `1px solid ${HOME_THEME.border}`, padding: "1px 8px", borderRadius: 4, fontWeight: 700, color: HOME_THEME.text }}>{cards.length}</span>
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                    {cards.map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          dragId.current = t.id; setDragging(t.id);
                          e.dataTransfer.setData("text/plain", t.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => { dragId.current = null; setDragging(null); setOverCol(null); }}
                        className={`conf-hover cu-card${dragging === t.id ? " dragging" : ""}`}
                        style={{
                          background: "rgba(255,255,255,0.02)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
                            color: t.boxColor, background: rgba(t.boxColor, 0.12),
                            border: `1px solid ${rgba(t.boxColor, 0.35)}`, borderRadius: 4, padding: "1px 8px",
                          }}>{titles[t.boxKey]}</span>
                          <button
                            onClick={() => deleteAnywhere(t.id)}
                            style={{ background: "none", border: "none", color: HOME_THEME.muted, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                          >×</button>
                        </div>
                        <div style={{
                          fontSize: 14, color: HOME_THEME.text, fontWeight: 600, lineHeight: 1.4, margin: "8px 0 0",
                          textDecoration: t.checked ? "line-through" : "none",
                          opacity: t.checked ? 0.65 : 1,
                        }}>{t.text}</div>
                      </div>
                    ))}
                    {!cards.length && (
                      <div style={{ color: HOME_THEME.muted, opacity: 0.5, fontSize: 14, fontStyle: "italic", padding: "8px 2px" }}>
                        {status === "All Todo" ? "New checklist items land here" : "Drag a card here"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={modalOverlay} onClick={() => setShowCreate(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 12, borderBottom: `1px solid ${HOME_THEME.border}` }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em", margin: 0, color: HOME_THEME.cyan }}>Add New Item</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: 14, cursor: "pointer", color: HOME_THEME.muted, lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={createItem}>
              <div style={formGroup}><label style={formLabel}>Title</label>
                <input style={formInput} value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="e.g. Review portfolio" required autoFocus /></div>
              <div style={formGroup}><label style={formLabel}>Checklist</label>
                <ThemedSelect value={cBox} onChange={setCBox} options={BOXES.map((b) => ({ value: b.key, label: titles[b.key] }))} /></div>
              <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.7 }}>
                Lands in <b style={{ color: HOME_THEME.cyan }}>All Todo</b> on the Checklist Update board.
              </div>
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
