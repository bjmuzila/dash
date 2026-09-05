/**
 * Personal · Todo — a grid of checklists, each item carrying its own status.
 *
 * ONE page, one source of truth. Every item has a `status` pill that cycles
 * Starting → In Progress → Completed, edited in place on the item itself.
 * (The old drag-and-drop "Checklist Update" board was removed — the pill does
 * the same job without a second copy of the list to keep in sync.)
 *
 * The lists themselves are DATA, not four hardcoded boxes: the defaults are
 * Main · Family · List 1 · List 2, and "Add a list" appends more. The list
 * order is carried in the titles map under the reserved `__order` key, because
 * the API returns titles as an unordered map and object key order out of
 * Postgres is not guaranteed.
 *
 * The underlying list KEYS are unchanged from the four-pillar version
 * (work/family/ideas/weekly) so existing rows keep their home; only the
 * display titles moved to Main / Family / List 1 / List 2, and a stored title
 * still equal to its old default is renamed on load.
 *
 * Storage is POSTGRES, via /api/owner/todo (owner_todo_item + owner_todo_list).
 * localStorage is written too, but only as an offline cache and as the
 * one-time migration source for a board that predates the table — the
 * database is the truth.
 *
 * The whole document is saved on a debounce rather than a request per gesture:
 * every mutation here rewrites one object, so per-gesture calls would race each
 * other over the same ordering.
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
  purple: "#126783", // deep teal
  green: "#8ECAE6",  // light blue (Completed)
  orange: "#FB8501", // orange
};

// Budget card surface: frosted panel + faint light-blue radial highlight (no top bar).
const budgetRadial = HOME_THEME_BASE.panelBg;

// ── Types & defaults ──────────────────────────────────────────────────────────

type Status = "Starting" | "In Progress" | "Completed";

interface CheckItem {
  id: string;
  text: string;
  checked: boolean;
  status: Status;
}

type Checklists = Record<string, CheckItem[]>;
type PillarTitles = Record<string, string>;

/** Reserved titles key holding the list order (the API returns titles unordered). */
const ORDER_KEY = "__order";

const DEFAULT_ORDER = ["work", "family", "ideas", "weekly"];

const DEFAULT_TITLES: PillarTitles = {
  work: "Main", family: "Family", ideas: "List 1", weekly: "List 2",
};

/** Titles from the four-pillar version. A stored title still equal to one of
 *  these was never renamed by hand, so it follows the new default. */
const LEGACY_TITLES: PillarTitles = {
  work: "Work", family: "Family", ideas: "Ideas", weekly: "Weekly Goals",
};

/** One color per list slot, cycled — lists are unbounded now. */
const PALETTE = [
  HOME_THEME.cyan,
  HOME_THEME.orange,
  HOME_THEME.purple,
  HOME_THEME.green,
  "#F472B6",
  "#A3E635",
  "#FBBF24",
  "#60A5FA",
];
const listColor = (idx: number) => PALETTE[idx % PALETTE.length];

const STATUSES: Status[] = ["Starting", "In Progress", "Completed"];
const STATUS_COLORS: Record<Status, string> = {
  Starting: HOME_THEME.cyan,
  "In Progress": HOME_THEME.orange,
  Completed: HOME_THEME.green,
};
/** Pre-pill statuses that no longer exist. */
const STATUS_ALIASES: Record<string, Status> = {
  "All Todo": "Starting",
  Todo: "Starting",
  "To Do": "Starting",
};
const nextStatus = (s: Status): Status => STATUSES[(STATUSES.indexOf(s) + 1) % STATUSES.length];
const coerceStatus = (raw: unknown, checked: boolean): Status => {
  const s = String(raw ?? "");
  if (STATUSES.includes(s as Status)) return s as Status;
  if (STATUS_ALIASES[s]) return STATUS_ALIASES[s];
  return checked ? "Completed" : "Starting";
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
 * — items written before `status` existed, or under a status that no longer
 * exists. Normalize on read so the page never has to defend against it.
 */
function normalizeLists(raw: unknown): Checklists {
  const out: Checklists = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key === ORDER_KEY || !Array.isArray(list)) continue;
    out[key] = list
      .filter((i) => i && typeof i === "object")
      .map((i) => {
        const it = i as Partial<CheckItem>;
        const checked = !!it.checked;
        const status = coerceStatus(it.status, checked);
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

/** A fresh list key that collides with nothing already in use. */
function newListKey(taken: string[]): string {
  for (let n = 1; n < 999; n++) {
    const k = "l" + n;
    if (!taken.includes(k)) return k;
  }
  return "l_" + Date.now().toString(36);
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

/** The status pill: one click advances Starting → In Progress → Completed. */
function StatusPill({ status, onCycle }: { status: Status; onCycle: () => void }) {
  const col = STATUS_COLORS[status];
  return (
    <button
      type="button"
      className="status-pill"
      onClick={onCycle}
      title="Click to change status"
      style={{
        fontSize: 10, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase",
        whiteSpace: "nowrap", padding: "2px 9px", borderRadius: 999, cursor: "pointer",
        color: col,
        background: rgba(col, 0.13),
        border: `1px solid ${rgba(col, 0.45)}`,
        display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, boxShadow: `0 0 6px ${rgba(col, 0.8)}` }} />
      {status}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

/** The board as the API carries it: flat, ordered, list tagged per item. */
type WireItem = { id: string; listKey: string; text: string; checked: boolean; status: Status };

function flatten(order: string[], lists: Checklists): WireItem[] {
  return order.flatMap((key) =>
    (lists[key] ?? []).map((i) => ({ id: i.id, listKey: key, text: i.text, checked: i.checked, status: i.status })),
  );
}
function unflatten(order: string[], items: WireItem[]): Checklists {
  const out: Checklists = {};
  for (const k of order) out[k] = [];
  for (const i of items) {
    if (!out[i.listKey]) continue;
    const status = coerceStatus(i.status, !!i.checked);
    out[i.listKey].push({ id: i.id, text: String(i.text ?? ""), checked: status === "Completed" ? true : !!i.checked, status });
  }
  return out;
}

/** Order comes off the reserved titles key; anything unlisted is appended. */
function readOrder(titles: PillarTitles, extraKeys: string[]): string[] {
  const raw = String(titles[ORDER_KEY] ?? "");
  const fromRaw = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const known = fromRaw.length ? fromRaw : DEFAULT_ORDER.slice();
  const seen = new Set(known);
  for (const k of Object.keys(titles)) if (k !== ORDER_KEY && !seen.has(k)) { known.push(k); seen.add(k); }
  for (const k of extraKeys) if (k !== ORDER_KEY && !seen.has(k)) { known.push(k); seen.add(k); }
  return known;
}

/** Titles the page displays: stored value, unless it is empty or still the
 *  old four-pillar default, in which case the new default wins. */
function mergeTitles(stored: PillarTitles): PillarTitles {
  const out: PillarTitles = { ...DEFAULT_TITLES };
  for (const [k, v] of Object.entries(stored || {})) {
    if (k === ORDER_KEY) continue;
    const t = String(v ?? "").trim();
    if (!t) continue;
    if (LEGACY_TITLES[k] && t === LEGACY_TITLES[k] && DEFAULT_TITLES[k]) continue; // never renamed by hand
    out[k] = t;
  }
  return out;
}

export default function Todo() {
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [checklists, setChecklists] = useState<Checklists>(() => {
    const o: Checklists = {}; for (const k of DEFAULT_ORDER) o[k] = []; return o;
  });
  const [titles, setTitles] = useState<PillarTitles>(DEFAULT_TITLES);
  const [showCreate, setShowCreate] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cBox, setCBox] = useState(DEFAULT_ORDER[0]);
  const [newListName, setNewListName] = useState("");
  /** A list header × arms itself before it deletes — no browser confirm dialog. */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

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
      const cachedTitlesRaw = loadLS<PillarTitles>(LS_TITLES, {});
      try {
        const res = await fetch("/api/owner/todo", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (dead) return;
        const items: WireItem[] = Array.isArray(data?.items) ? data.items : [];
        const serverTitles: PillarTitles =
          data?.titles && typeof data.titles === "object" ? data.titles : {};
        const cachedCount = Object.values(cachedLists).reduce((n, l) => n + l.length, 0);
        if (items.length === 0 && cachedCount > 0) {
          // Adopt the local board and let the save effect below write it up.
          const ord = readOrder(cachedTitlesRaw, Object.keys(cachedLists));
          setOrder(ord);
          setChecklists(withKeys(ord, cachedLists));
          setTitles(mergeTitles(cachedTitlesRaw));
          setMigrating(true);
        } else {
          const ord = readOrder(serverTitles, items.map((i) => i.listKey));
          setOrder(ord);
          setChecklists(unflatten(ord, items));
          setTitles(mergeTitles(serverTitles));
        }
      } catch {
        // Offline or the endpoint is down. Show the cache and DON'T save over
        // the database with it — saving is gated on a load having succeeded.
        if (dead) return;
        const ord = readOrder(cachedTitlesRaw, Object.keys(cachedLists));
        setOrder(ord);
        setChecklists(withKeys(ord, cachedLists));
        setTitles(mergeTitles(cachedTitlesRaw));
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
    const wireTitles: PillarTitles = { ...titles, [ORDER_KEY]: order.join(",") };
    try {
      localStorage.setItem(LS_LISTS, JSON.stringify(checklists));
      localStorage.setItem(LS_TITLES, JSON.stringify(wireTitles));
    } catch { /* private mode — the database is still the truth */ }

    const body = JSON.stringify({ items: flatten(order, checklists), titles: wireTitles });
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
  }, [hydrated, loadFailed, checklists, titles, order]);

  // The browser's own guard, for the 600ms a change has not reached Postgres.
  useEffect(() => {
    if (saveState !== "saving" && saveState !== "error") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // The create-modal's list picker must never point at a deleted list.
  useEffect(() => {
    if (order.length && !order.includes(cBox)) setCBox(order[0]);
  }, [order, cBox]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  /** Apply a patch to one item wherever it lives, without knowing its list. */
  const patchItem = (id: string, patch: (i: CheckItem) => CheckItem) =>
    setChecklists((c) => {
      const next: Checklists = {};
      for (const k of Object.keys(c)) next[k] = c[k].map((i) => (i.id === id ? patch(i) : i));
      return next;
    });

  /** Checkbox ⇔ Completed. Unticking returns the item to Starting. */
  const toggleCheck = (id: string) =>
    patchItem(id, (i) => {
      const checked = !i.checked;
      return { ...i, checked, status: checked ? "Completed" : "Starting" };
    });

  /** The pill: advance the status, keeping the checkbox in step. */
  const cycleStatus = (id: string) =>
    patchItem(id, (i) => {
      const status = nextStatus(i.status);
      return { ...i, status, checked: status === "Completed" };
    });

  const deleteItem = (key: string, id: string) =>
    setChecklists((c) => ({ ...c, [key]: (c[key] ?? []).filter((i) => i.id !== id) }));

  const renameItem = (key: string, id: string, text: string) => {
    const v = text.trim();
    if (!v) return;
    setChecklists((c) => ({ ...c, [key]: (c[key] ?? []).map((i) => (i.id === id ? { ...i, text: v } : i)) }));
  };

  const renamePillar = (key: string, text: string) => {
    const v = text.trim();
    if (v) setTitles((t) => ({ ...t, [key]: v }));
  };

  /** Every new item starts life in the first status. */
  const addItem = (key: string, text: string) => {
    const v = text.trim();
    if (!v) return;
    const item: CheckItem = { id: "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: v, checked: false, status: "Starting" };
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

  /** Add a list. The key is generated; the typed name is only the title. */
  const addList = () => {
    const name = newListName.trim() || `List ${order.length + 1}`;
    const key = newListKey(order);
    setOrder((o) => [...o, key]);
    setTitles((t) => ({ ...t, [key]: name.slice(0, 120) }));
    setChecklists((c) => ({ ...c, [key]: [] }));
    setNewListName("");
  };

  /** Remove a list and everything on it. Armed by a first click on the ×. */
  const removeList = (key: string) => {
    setOrder((o) => o.filter((k) => k !== key));
    setTitles((t) => { const n = { ...t }; delete n[key]; return n; });
    setChecklists((c) => { const n = { ...c }; delete n[key]; return n; });
    setConfirmDel(null);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const allItems = useMemo(
    () => order.flatMap((k) => checklists[k] ?? []),
    [order, checklists],
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
        .status-pill{transition:filter .12s ease, transform .12s ease;}
        .status-pill:hover{filter:brightness(1.25);transform:translateY(-1px);}
        .status-pill:active{transform:translateY(0);}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle text="Checklists" accent={HOME_THEME.cyan} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
            {order.map((key, idx) => {
              const items = checklists[key] ?? [];
              const color = listColor(idx);
              const arming = confirmDel === key;
              return (
                <div key={key} className="conf-hover" style={{
                  ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column",
                  background: budgetRadial,
                }}>
                  <div style={{ fontSize: 17, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em", color: HOME_THEME.text, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${rgba(color, 0.7)}` }} />
                    <span
                      contentEditable suppressContentEditableWarning
                      onBlur={(e) => renamePillar(key, e.currentTarget.innerText)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                      style={{ cursor: "pointer", outline: "none", flex: 1 }}
                    >
                      {titles[key] ?? key}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.muted, opacity: 0.7 }}>{items.length}</span>
                    {order.length > 1 && (
                      <button
                        onClick={() => (arming ? removeList(key) : setConfirmDel(key))}
                        onBlur={() => setConfirmDel((k) => (k === key ? null : k))}
                        title={arming ? "Click again to delete this list and its items" : "Delete list"}
                        style={{
                          background: arming ? rgba(HOME_THEME.orange, 0.15) : "none",
                          border: arming ? `1px solid ${rgba(HOME_THEME.orange, 0.5)}` : "1px solid transparent",
                          color: arming ? HOME_THEME.orange : HOME_THEME.muted,
                          cursor: "pointer", fontSize: arming ? 10 : 14, fontWeight: 800,
                          lineHeight: 1, padding: arming ? "3px 7px" : "0 2px", borderRadius: 999,
                          letterSpacing: arming ? ".06em" : undefined, opacity: arming ? 1 : 0.6,
                        }}
                      >{arming ? "SURE?" : "×"}</button>
                    )}
                  </div>
                  <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, flexGrow: 1 }}>
                    {items.length ? items.map((item) => (
                      <li key={item.id} style={{
                        display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8,
                        fontSize: 14, color: HOME_THEME.text, lineHeight: 1.4, justifyContent: "space-between",
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexGrow: 1, minWidth: 0 }}>
                          <input type="checkbox" checked={item.checked}
                            onChange={() => toggleCheck(item.id)}
                            style={{ marginTop: 2, flexShrink: 0, width: 13, height: 13, cursor: "pointer", accentColor: HOME_THEME.cyan }} />
                          <span
                            contentEditable suppressContentEditableWarning
                            onBlur={(e) => renameItem(key, item.id, e.currentTarget.innerText)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                            style={{
                              outline: "none", cursor: "pointer", flexGrow: 1, minWidth: 0,
                              textDecoration: item.checked ? "line-through" : "none",
                              color: item.checked ? HOME_THEME.muted : HOME_THEME.text,
                              opacity: item.checked ? 0.6 : 1,
                            }}
                          >
                            {item.text}
                          </span>
                        </div>
                        <StatusPill status={item.status} onCycle={() => cycleStatus(item.id)} />
                        <button onClick={() => deleteItem(key, item.id)} style={{
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
                      ref={(el) => { inlineRefs.current[key] = el; }}
                      type="text" placeholder="Add item..."
                      onKeyDown={(e) => { if (e.key === "Enter") inlineAdd(key); }}
                      style={{ ...homeInputStyle, flex: 1, fontSize: 14, padding: "5px 8px" }}
                    />
                  </div>
                </div>
              );
            })}

            {/* ADD A LIST — the grid's last cell, so new lists appear in place */}
            <div style={{
              ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 10,
              background: "transparent",
              border: `1px dashed ${rgba(HOME_THEME.cyan, 0.35)}`,
              justifyContent: "center", minHeight: 140,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em", color: HOME_THEME.cyan, opacity: 0.9 }}>
                Add a list
              </div>
              <input
                type="text" value={newListName} placeholder="List name..."
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addList(); } }}
                style={{ ...homeInputStyle, width: "100%", fontSize: 14, padding: "5px 8px" }}
              />
              <button style={{ ...btnPrimary, justifyContent: "center" }} onClick={addList}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New List
              </button>
            </div>
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
                <ThemedSelect value={cBox} onChange={setCBox} options={order.map((k) => ({ value: k, label: titles[k] ?? k }))} /></div>
              <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.7 }}>
                Starts at <b style={{ color: HOME_THEME.cyan }}>Starting</b> — click the pill to move it along.
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

/** Guarantee every key in `order` exists on the map (an empty list is a list). */
function withKeys(order: string[], lists: Checklists): Checklists {
  const out: Checklists = {};
  for (const k of order) out[k] = lists[k] ?? [];
  for (const [k, v] of Object.entries(lists)) if (!(k in out)) out[k] = v;
  return out;
}
